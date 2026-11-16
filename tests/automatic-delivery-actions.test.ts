import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createAgentSessionDomain } from '../src/host/agent-sessions.ts';
import { createAutomaticActionSettingsStore } from '../src/host/automatic-action-settings-store.ts';
import { runAutomaticDeliveryActions } from '../src/host/automatic-delivery-actions.ts';
import type { AnalysisDeliveryReceipt } from '../src/host/analysis-delivery.ts';
import { createVerificationStore } from '../src/host/verification-store.ts';
const delivery = (): AnalysisDeliveryReceipt => ({ schemaVersion: 1, type: 'optracall.analysis-delivery', projectId: randomUUID(), taskId: randomUUID(), requestId: randomUUID(), sessionId: randomUUID(), toolCallId: 'exact-declaration-tool', completion: 'complete', format: 'full-report', summary: 'Agent明确交付声明；专业结果未验收', limitations: ['仍有待核内容'], selfCheck: { performed: true, findings: [] }, methodChecks: [], reports: [], save: { status: 'not-requested' }, claim: 'declared-not-professionally-verified' });
async function environment(run: (env: { dataRoot: string; settings: ReturnType<typeof createAutomaticActionSettingsStore>; domain: ReturnType<typeof createAgentSessionDomain<string>>; ref: ReturnType<ReturnType<typeof createAgentSessionDomain<string>>['ref']>; declared: AnalysisDeliveryReceipt }) => Promise<void>) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-auto-delivery-')), settings = createAutomaticActionSettingsStore({ dataRoot }), declared = delivery();
  declared.reports = [{ projectId: declared.projectId, taskId: declared.taskId, requestId: declared.requestId, sessionId: declared.sessionId, toolCallId: 'saved-file', relativePath: '060_reports/exact-report.md', sha256: createHash('sha256').update('s'.repeat(40)).digest('hex'), bytes: 40 }];
  const configuration = { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', api: 'openai-completions' as const, model: 'synthetic', apiKey: 'synthetic', baseUrl: 'http://127.0.0.1:1' };
  const domain = createAgentSessionDomain<string>({ name: 'automatic-post-actions-test', profile: { key: owner => owner, configuration: () => configuration, agentOptions: () => { throw new Error('post-action dispatcher must never open a Runtime'); } }, configurationSnapshot: () => configuration, mutate: async run => run(), isClosing: () => false });
  const ref = domain.ref(`${declared.projectId}/${declared.taskId}`);
  try { await run({ dataRoot, settings, domain, ref, declared }); } finally { await domain.closeAll(); await rm(dataRoot, { recursive: true, force: true }); }
}
test('normal completion with the exact Agent declaration dispatches enabled callbacks inside the original live lease', () => environment(async ({ settings, domain, ref, declared }) => {
  const current = await settings.read(); await settings.update({ operationId: randomUUID(), expectedRevision: current.revision, nodes: { ...current.nodes, review: true } });
  const calls: unknown[] = [], observations: unknown[] = [];
  await domain.withSession(ref, async lease => {
    const assertCurrent = () => { assert.equal(domain.owns(ref, lease.context), true); };
    const result = await runAutomaticDeliveryActions({ delivery: declared, runResult: { outcome: 'completed' }, requestId: declared.requestId, lease, assertCurrent, readCurrent: settings.readCurrent, review: { authorized: true, applicable: true, run: async input => { calls.push(input); assert.equal(input.parent.context, lease.context); await input.parent.assertCurrent(); return { originalReceipt: 'fixed-original-review', state: 'completed-with-limitations' }; } }, record: observation => { observations.push(observation); } });
    assert.equal(calls.length, 1); assert.equal(result[0].outcome, 'returned'); assert.equal(observations.length, 2); assert.equal(domain.busy(ref), true);
  });
  assert.equal(domain.busy(ref), false);
}));
test('ordinary completion, cancellation, failed runs, other requests and unbound declarations cannot trigger actions', () => environment(async ({ settings, domain, ref, declared }) => {
  let calls = 0, reads = 0;
  await domain.withSession(ref, async lease => {
    const base = { requestId: declared.requestId, lease, assertCurrent: () => { assert.equal(domain.owns(ref, lease.context), true); }, readCurrent: async (...args: Parameters<typeof settings.readCurrent>) => { reads++; return settings.readCurrent(...args); }, review: { authorized: true, applicable: true, run: async () => { calls++; } } };
    for (const outcome of ['cancelled', 'failed'] as const) assert.deepEqual(await runAutomaticDeliveryActions({ ...base, runResult: { outcome }, delivery: declared }), []);
    assert.deepEqual(await runAutomaticDeliveryActions({ ...base, runResult: { outcome: 'completed' } }), []);
    assert.deepEqual(await runAutomaticDeliveryActions({ ...base, runResult: { outcome: 'completed' }, delivery: { ...declared, requestId: randomUUID() } }), []);
    assert.deepEqual(await runAutomaticDeliveryActions({ ...base, runResult: { outcome: 'completed' }, delivery: { ...declared, reports: [] } }), []);
    assert.equal(calls, 0); assert.equal(reads, 0);
  });
}));
test('settings are reread before each action; disabling never cancels the callback already in progress and IR-off cannot be bypassed by assets', () => environment(async ({ settings, domain, ref, declared }) => {
  let current = await settings.read(); await settings.update({ operationId: randomUUID(), expectedRevision: current.revision, nodes: { ...current.nodes, review: true, ir: true, assets: true } });
  let reviewSettled = false, irCalls = 0, assetsCalls = 0;
  await domain.withSession(ref, async lease => {
    const result = await runAutomaticDeliveryActions({ delivery: declared, runResult: { outcome: 'completed' }, requestId: declared.requestId, lease, assertCurrent: () => { assert.equal(domain.owns(ref, lease.context), true); }, readCurrent: settings.readCurrent,
      review: { authorized: true, applicable: true, run: async () => { current = await settings.read(); await settings.update({ operationId: randomUUID(), expectedRevision: current.revision, nodes: { ...current.nodes, review: false, ir: false } }); assert.equal(domain.owns(ref, lease.context), true, 'switch changes do not revoke original in-flight owner'); reviewSettled = true; return { state: 'unknown', originalReceiptId: 'original-review-unknown' }; } },
      ir: { authorized: true, applicable: true, run: async () => { irCalls++; throw new Error('IR must stay off'); } },
      assets: { authorized: true, applicable: true, run: async input => { assetsCalls++; assert.equal(reviewSettled, true); assert.deepEqual(input.reviewResult, { state: 'unknown', originalReceiptId: 'original-review-unknown' }); return { state: 'updated-existing-candidate-only' }; } },
    });
    assert.equal(irCalls, 0); assert.equal(assetsCalls, 1); assert.equal(result.find(item => item.node === 'ir')?.reason, 'disabled'); assert.equal(result[0].outcome, 'returned');
  });
}));
test('stopping the original parent prevents later dispatch and any native write after revocation while preserving the child receipt', () => environment(async ({ settings, domain, ref, declared }) => {
  const current = await settings.read(); await settings.update({ operationId: randomUUID(), expectedRevision: current.revision, nodes: { ...current.nodes, review: true, ir: true } });
  let irCalls = 0, records = 0;
  await domain.withSession(ref, async lease => {
    const result = await runAutomaticDeliveryActions({ delivery: declared, runResult: { outcome: 'completed' }, requestId: declared.requestId, lease, assertCurrent: () => { if (!domain.owns(ref, lease.context)) throw Object.assign(new Error('generation_cancelled'), { code: 'generation_cancelled' }); }, readCurrent: settings.readCurrent,
      review: { authorized: true, applicable: true, run: async input => { let cancelled = false; const release = input.parent.onCancel(() => { cancelled = true; }); await domain.stop(ref); release(); assert.equal(cancelled, true); return { state: 'cancelled', originalReceiptId: 'review-cancelled' }; } },
      ir: { authorized: true, applicable: true, run: async () => { irCalls++; } }, record: () => { assert.equal(domain.owns(ref, lease.context), true); records++; },
    });
    assert.equal(irCalls, 0); assert.equal(records, 1); assert.deepEqual(result[0].result, { state: 'cancelled', originalReceiptId: 'review-cancelled' });
  });
}));
test('a native observation failure is not rewritten as another action result and never invokes a second action callback', () => environment(async ({ settings, domain, ref, declared }) => {
  const current = await settings.read(); await settings.update({ operationId: randomUUID(), expectedRevision: current.revision, nodes: { ...current.nodes, review: true } });
  let calls = 0, settledRecords = 0;
  await domain.withSession(ref, async lease => {
    await assert.rejects(runAutomaticDeliveryActions({ delivery: declared, runResult: { outcome: 'completed' }, requestId: declared.requestId, lease, assertCurrent: () => { assert.equal(domain.owns(ref, lease.context), true); }, readCurrent: settings.readCurrent,
      review: { authorized: true, applicable: true, run: async () => { calls++; return { originalReceiptId: 'review-1' }; } },
      record: observation => { if (observation.phase === 'settled') { settledRecords++; throw Object.assign(new Error('native write unknown'), { code: 'native_write_unknown' }); } },
    }), /native write unknown/);
    assert.equal(calls, 1); assert.equal(settledRecords, 1);
  });
}));
test('repeated dispatch uses stable IDs and the original business receipt for deduplication, retaining UNKNOWN as an original result', () => environment(async ({ dataRoot, settings, domain, ref, declared }) => {
  const current = await settings.read(); await settings.update({ operationId: randomUUID(), expectedRevision: current.revision, nodes: { ...current.nodes, review: true } });
  const store = createVerificationStore({ dataRoot }), ids: string[] = [], created: boolean[] = [];
  await domain.withSession(ref, async lease => {
    const input = { delivery: declared, runResult: { outcome: 'completed' as const }, requestId: declared.requestId, lease, assertCurrent: () => { assert.equal(domain.owns(ref, lease.context), true); }, readCurrent: settings.readCurrent,
      review: { authorized: true, applicable: true, run: async (action: { requestId: string }) => {
        ids.push(action.requestId); const binding = declared.reports[0], report = { relativePath: binding.relativePath, sha256: binding.sha256, bytes: binding.bytes }, bytes = Buffer.from('s'.repeat(40));
        const result = await store.create({ projectId: declared.projectId, taskId: declared.taskId, verificationId: action.requestId, mode: 'conclusion-review', question: 'Fixed report review', selection: { verificationId: action.requestId, report: { relativePath: report.relativePath, sha256: report.sha256 } }, configuration: { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic' }, dataFiles: [], authorFiles: [{ relativePath: report.relativePath, bytes }], review: { schemaVersion: 1, report, materials: [{ id: 'report', kind: 'report', locator: report.relativePath, sha256: report.sha256, bytes: report.bytes, state: 'provided' }], providedText: 'Fixed report only' } });
        created.push(result.created); return { originalReceiptId: result.record.verificationId, state: 'unknown', diagnostic: 'Original business state preserved' };
      } },
    };
    const first = await runAutomaticDeliveryActions(input), second = await runAutomaticDeliveryActions(input);
    assert.equal(first[0].outcome, 'returned', JSON.stringify(first));
    assert.deepEqual(created, [true, false]); assert.equal(ids[0], ids[1]); assert.deepEqual(first[0].result, second[0].result); assert.equal((first[0].result as { state: string }).state, 'unknown');
    assert.equal((await store.listForManagement(declared.projectId, declared.taskId)).length, 1);
  });
}));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
test('one global change affects another running Task only at its corresponding not-yet-started action', () => environment(async ({ settings, domain, ref, declared }) => {
  const current = await settings.read(); await settings.update({ operationId: randomUUID(), expectedRevision: current.revision, nodes: { ...current.nodes, review: true, ir: true } });
  const entered = deferred(), release = deferred(), b = structuredClone(declared); b.taskId = randomUUID(); b.requestId = randomUUID(); b.reports[0].taskId = b.taskId; b.reports[0].requestId = b.requestId;
  const other = domain.ref(`${b.projectId}/${b.taskId}`); let irCalls = 0, bReviewSettled = false;
  const runningB = domain.withSession(other, lease => runAutomaticDeliveryActions({ delivery: b, runResult: { outcome: 'completed' }, requestId: b.requestId, lease, assertCurrent: () => { assert.equal(domain.owns(other, lease.context), true); }, readCurrent: settings.readCurrent,
    review: { authorized: true, applicable: true, run: async () => { entered.resolve(); await release.promise; assert.equal(domain.owns(other, lease.context), true); bReviewSettled = true; return { originalReceiptId: 'b-review-completed' }; } }, ir: { authorized: true, applicable: true, run: async () => { irCalls++; } },
  }));
  await entered.promise;
  await domain.withSession(ref, lease => runAutomaticDeliveryActions({ delivery: declared, runResult: { outcome: 'completed' }, requestId: declared.requestId, lease, assertCurrent: () => { assert.equal(domain.owns(ref, lease.context), true); }, readCurrent: settings.readCurrent,
    review: { authorized: true, applicable: true, run: async () => { const latest = await settings.read(); await settings.update({ operationId: randomUUID(), expectedRevision: latest.revision, nodes: { ...latest.nodes, ir: false } }); return { originalReceiptId: 'a-review-completed' }; } }, ir: { authorized: true, applicable: true, run: async () => { irCalls++; } },
  }));
  assert.equal(bReviewSettled, false); release.resolve(); const result = await runningB;
  assert.equal(bReviewSettled, true); assert.equal(irCalls, 0); assert.equal(result.find(item => item.node === 'ir')?.reason, 'disabled');
}));
test('revocation while awaiting a current setting prevents dispatch and neither authorization nor applicability can be inferred from an enabled switch', () => environment(async ({ settings, domain, ref, declared }) => {
  const current = await settings.read(); await settings.update({ operationId: randomUUID(), expectedRevision: current.revision, nodes: { ...current.nodes, review: true, ir: true, case: true, assets: true } });
  let calls = 0;
  await domain.withSession(ref, async lease => {
    const base = { delivery: declared, runResult: { outcome: 'completed' as const }, requestId: declared.requestId, lease, assertCurrent: () => { if (!domain.owns(ref, lease.context)) throw new Error('generation_cancelled'); }, readCurrent: settings.readCurrent };
    const denied = await runAutomaticDeliveryActions({ ...base, review: { authorized: false, applicable: true, run: async () => { calls++; } }, case: { authorized: true, applicable: false, run: async () => { calls++; } }, assets: { authorized: true, applicable: false, run: async () => { calls++; } } });
    assert.deepEqual(denied.map(item => item.reason), ['not_authorized', 'not_applicable', 'not_applicable']);
    const stopped = await runAutomaticDeliveryActions({ ...base, readCurrent: async (...args) => { const decision = await settings.readCurrent(...args); await domain.stop(ref); return decision; }, review: { authorized: true, applicable: true, run: async () => { calls++; } } });
    assert.deepEqual(stopped, []); assert.equal(calls, 0);
  });
}));
test('a callback exception preserves UNKNOWN without guessing professional success and only exact declared references reach the next callback', () => environment(async ({ settings, domain, ref, declared }) => {
  const current = await settings.read(); await settings.update({ operationId: randomUUID(), expectedRevision: current.revision, nodes: { ...current.nodes, review: true, assets: true } });
  await domain.withSession(ref, async lease => {
    let assetsCalls = 0;
    const outcomes = await runAutomaticDeliveryActions({ delivery: declared, runResult: { outcome: 'completed' }, requestId: declared.requestId, lease, assertCurrent: () => { assert.equal(domain.owns(ref, lease.context), true); }, readCurrent: settings.readCurrent,
      review: { authorized: true, applicable: true, run: async () => { throw Object.assign(new Error('original request lost after dispatch'), { code: 'review_receipt_unknown' }); } },
      assets: { authorized: true, applicable: true, run: async input => { assetsCalls++; assert.deepEqual(input.delivery.reports, declared.reports); assert.equal(input.reviewResult, undefined); return { existingRef: 'declared-original-candidate' }; } },
    });
    assert.equal(assetsCalls, 1); assert.equal(outcomes[0].outcome, 'unknown'); assert.equal(outcomes[0].code, 'review_receipt_unknown'); assert.equal(outcomes[1].outcome, 'returned');
  });
}));
test('the original action ID stays stable across report order and process collation, and changes for another bound report version', () => environment(async ({ settings, domain, ref, declared }) => {
  const current = await settings.read(); await settings.update({ operationId: randomUUID(), expectedRevision: current.revision, nodes: { ...current.nodes, review: true } });
  declared.reports.push({ ...declared.reports[0], relativePath: '060_reports/z-other.md', sha256: 'b'.repeat(64) });
  await domain.withSession(ref, async lease => {
    const ids: string[] = [], base = { runResult: { outcome: 'completed' as const }, requestId: declared.requestId, lease, assertCurrent: () => { assert.equal(domain.owns(ref, lease.context), true); }, readCurrent: settings.readCurrent, review: { authorized: true, applicable: true, run: async (input: { requestId: string }) => { ids.push(input.requestId); return { ref: input.requestId }; } } };
    await runAutomaticDeliveryActions({ ...base, delivery: declared });
    const compare = String.prototype.localeCompare;
    try { String.prototype.localeCompare = function(other: string) { return -compare.call(this, other); }; await runAutomaticDeliveryActions({ ...base, delivery: { ...declared, reports: declared.reports.slice().reverse() } }); }
    finally { String.prototype.localeCompare = compare; }
    assert.equal(ids[0], ids[1]);
    await runAutomaticDeliveryActions({ ...base, delivery: { ...declared, reports: [{ ...declared.reports[0], sha256: 'c'.repeat(64) }] } });
    assert.notEqual(ids[0], ids[2]);
  });
}));
