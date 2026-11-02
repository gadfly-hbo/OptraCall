import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createSimulationTools } from '../extensions/business-plugins/sim-lab/tools/simulation-tools.ts';
import { SimLabService } from '../extensions/business-plugins/sim-lab/service/simlab-service.ts';

const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

type Envelope = { status: string; data?: any; code?: string; message?: string };
function call(tool: any, params: Record<string, unknown>): Promise<{ details: Envelope; isError?: boolean }> {
  return tool.execute('test-call', params, undefined, undefined, undefined);
}
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-simlab-tools-')));
  const storeRoot = path.join(root, 'project');
  const tools = createSimulationTools({ storeRoot, projectId: PROJECT });
  const byName = Object.fromEntries(tools.map(tool => [tool.name, tool])) as Record<string, any>;
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  return { tools: byName, storeRoot };
}

test('SIM-TOOLS-01: five orthogonal tools; freeze is not an agent tool', async t => {
  const { tools } = await fixture(t);
  assert.deepEqual(Object.keys(tools).sort(), ['simulation_draft', 'simulation_evidence', 'simulation_inspect', 'simulation_run', 'simulation_stress']);
  assert.ok(!tools.simulation_freeze, 'freeze is a user-only page action, not an agent tool');
});

test('SIM-TOOLS-02: inspect returns engine caliber and unmodeled boundaries', async t => {
  const { tools } = await fixture(t);
  const result = await call(tools.simulation_inspect, {});
  assert.equal(result.details.status, 'succeeded');
  assert.equal(result.details.data.engineVersion, 'optracall-sim-2');
  assert.ok(result.details.data.unmodeled.includes('概率分布与随机仿真'));
  assert.ok(result.details.data.caliber.perturbations.includes('leadTimeDelta'));
});

test('SIM-TOOLS-03: agent full flow — draft, run, stress, evidence readback', async t => {
  const { tools, storeRoot } = await fixture(t);
  const created = await call(tools.simulation_draft, { action: 'create', name: 'Agent 草稿' });
  assert.equal(created.details.status, 'succeeded');
  const draft = created.details.data.draft;

  const updated = await call(tools.simulation_draft, { action: 'update', draftId: draft.id, parameters: { demand: 220 }, expectedRevision: 1 });
  assert.equal(updated.details.data.draft.parameters.demand, 220);
  assert.equal(updated.details.data.draft.revision, 2);

  const stale = await call(tools.simulation_draft, { action: 'update', draftId: draft.id, parameters: { demand: 300 }, expectedRevision: 1 });
  assert.equal(stale.details.status, 'rejected');
  assert.equal(stale.details.code, 'revision_conflict');
  assert.equal(stale.isError, true);

  const run = await call(tools.simulation_run, { draftId: draft.id });
  assert.equal(run.details.status, 'succeeded');
  assert.match(run.details.data.runId, /^RUN-\d{4}$/);
  assert.equal(Object.keys(run.details.data.results).length, 3);

  const ledger = await call(tools.simulation_run, { draftId: draft.id, includeLedger: true, variantId: 'baseline' });
  assert.equal(ledger.details.data.ledger.rows.length, 30);
  const badLedger = await call(tools.simulation_run, { draftId: draft.id, includeLedger: true, variantId: 'missing' });
  assert.equal(badLedger.details.code, 'invalid_variant');

  const stress = await call(tools.simulation_stress, { draftId: draft.id, perturbation: { demandMultiplier: 1.25 } });
  assert.equal(stress.details.data.rows.length, 3);
  const badStress = await call(tools.simulation_stress, { draftId: draft.id, perturbation: { demandMultiplier: -1 } });
  assert.equal(badStress.details.code, 'invalid_perturbation');

  const empty = await call(tools.simulation_evidence, {});
  assert.deepEqual(empty.details.data.snapshots, []);

  // 页面路径（用户在 UI 确认）由 service 固化；Agent 只能经 evidence 读回执。
  const service = new SimLabService(storeRoot, PROJECT);
  const snapshot = await service.freeze(draft.id, { runId: run.details.data.runId, variantId: 'baseline', expectedRevision: 2 });
  const listed = await call(tools.simulation_evidence, {});
  assert.equal(listed.details.data.snapshots.length, 1);
  assert.equal(listed.details.data.snapshots[0].id, snapshot.id);
  const detail = await call(tools.simulation_evidence, { snapshotId: snapshot.id, includeLedger: true });
  assert.equal(detail.details.data.snapshot.result.rows.length, 30);
  assert.equal(detail.details.data.snapshot.engineVersion, 'optracall-sim-2');
});

test('SIM-TOOLS-04: not-found and validation errors use structured rejection envelopes', async t => {
  const { tools } = await fixture(t);
  const missing = await call(tools.simulation_draft, { action: 'get', draftId: 'no-such-draft' });
  assert.equal(missing.details.status, 'rejected');
  assert.equal(missing.details.code, 'draft_not_found');
  const noName = await call(tools.simulation_draft, { action: 'create' });
  assert.equal(noName.details.code, 'invalid_name');
  const noRevision = await call(tools.simulation_draft, { action: 'update', draftId: 'x' });
  assert.equal(noRevision.details.code, 'revision_conflict');
  const noSnapshot = await call(tools.simulation_evidence, { snapshotId: 'SNAP-9999' });
  assert.equal(noSnapshot.details.code, 'snapshot_not_found');
});

test('SIM-TOOLS-05: unexpected storage faults do not expose Host paths or raw system messages', async t => {
  const { tools, storeRoot } = await fixture(t);
  await fs.writeFile(storeRoot, 'synthetic obstruction');
  const result = await call(tools.simulation_draft, { action: 'list' });
  assert.equal(result.details.status, 'rejected');
  assert.equal(result.details.code, 'simulation_failed');
  assert.ok(!JSON.stringify(result).includes(storeRoot));
  assert.ok(!JSON.stringify(result).includes('ENOTDIR'));
});

test('SIM-TOOLS-06: explicit suggestions identify the saved run and invalid suggestions do not run', async t => {
  const { tools, storeRoot } = await fixture(t), service = new SimLabService(storeRoot, PROJECT);
  const draft = await service.createDraft({ name: '建议合同' });
  const invalid = await call(tools.simulation_run, { draftId: draft.id, suggestFreeze: { variantId: 'missing', reason: '无效方案' } });
  assert.equal(invalid.details.code, 'invalid_variant');
  assert.deepEqual(await service.listRuns(), []);
  const ordinary = await call(tools.simulation_run, { draftId: draft.id });
  assert.equal(ordinary.details.data.freezeSuggestion, undefined);
  const proposed = await call(tools.simulation_run, { draftId: draft.id, suggestFreeze: { variantId: 'split', reason: '请用户核对分批方案' } });
  const suggestion = proposed.details.data.freezeSuggestion;
  assert.equal(suggestion.runId, proposed.details.data.runId);
  assert.equal(suggestion.draftRevision, draft.revision);
  assert.equal(suggestion.projectId, PROJECT);
  assert.equal(suggestion.inputHash, (await service.getRun(suggestion.runId)).results.split!.inputHash);
  assert.deepEqual(await service.listSnapshots(), [], 'suggestion is never a freeze action');
});
