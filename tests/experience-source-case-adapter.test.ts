import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EnterpriseMaterialsStore, enterpriseDraftSha256 } from '../src/host/enterprise-materials-store.ts';
import { PersonalRetentionStore } from '../src/host/personal-retention-store.ts';
import { createPersonalSourceReader } from '../src/host/personal-retention-sources.ts';
import { createPersonalContextReader } from '../src/host/personal-context-reader.ts';
import { AgentCandidateControls } from '../src/host/agent-candidate-controls.ts';
import type { CaseDecisionRef } from '../src/host/case-decision-types.ts';
import { createNativeSnapshotReadBudget } from '../src/host/native-session-snapshot.ts';

test('EL02 sourceIndex choice fragments retain exact strategy identity and disclose current Case governance with the shared read budget', async () => {
  const roots = path.resolve('.local/fourbase-modules/m6/implementation/sources/roots'); await fs.mkdir(roots, { recursive: true }); const dataRoot = await fs.mkdtemp(path.join(roots, 'case-adapter-'));
  const materials = new EnterpriseMaterialsStore(dataRoot), created = await materials.create({ title: 'Synthetic retained experience', body: 'Independent body' });
  const ref = { type: 'case-choice' as const, caseStoreId: randomUUID(), caseId: randomUUID(), choiceId: randomUUID(), excerpt: { start: 0, end: 5 } };
  const strategyRef: CaseDecisionRef = { type: 'case-decision', caseStoreId: ref.caseStoreId, caseId: ref.caseId, recordId: randomUUID(), revision: 7 };
  let receivedBudget: unknown, receivedAudience: unknown;
  const unused = () => { throw new Error('unexpected_source_domain'); };
  const reader = createPersonalSourceReader({ enterprise: materials, projects: { get: async () => unused(), getTask: async () => unused() }, dataContext: { readCitationEvidence: async () => unused() }, board: { getTask: unused, getItem: unused, getFeedbackRevision: unused }, readCaseSource: async (source, options) => { receivedBudget = options?.budget; receivedAudience = options?.audience; return { ref: source, title: '人的准确取舍', text: 'reason fragment', sha256: 'a'.repeat(64), status: 'available', strategyRef, caseGovernance: { caseStatus: 'closed', currentRevision: 9, lifecycle: 'archived' } }; } });
  const retention = new PersonalRetentionStore({ dataRoot, materials, readSource: reader }), saved = await retention.retain(created.material.id, { operationId: randomUUID(), expectedRevision: 0, target: { type: 'draft', expectedMaterialVersion: created.material.version, expectedDraftSha256: enterpriseDraftSha256(created.material.draft) }, metadata: { kind: 'experience', aliases: [], caution: null, sourceRefs: [ref] }, personalLabel: null });
  const controls = new AgentCandidateControls({ dataRoot, readTarget: async () => unused() }), personal = createPersonalContextReader({ projects: { list: async () => [] }, retention, controls });
  const target = { type: 'retained' as const, storeId: created.storeId, materialId: created.material.id, decisionId: saved.decision!.operationId, revisionId: saved.decision!.contentRef!.revisionId, expectedBodySha256: saved.decision!.bodySha256! }, budget = createNativeSnapshotReadBudget();
  const read = await personal.read({ target, part: 'source', sourceIndex: 0 }, { budget });
  assert.equal(receivedBudget, budget); assert.equal(receivedAudience, 'agent');
  assert.match(read.text, /closed/); assert.match(read.text, /archived/); assert.match(read.text, /9/);
  assert.ok(read.text.includes(JSON.stringify(strategyRef)), 'a selected choice fragment must still identify its exact original strategy');
});
