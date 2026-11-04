import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EnterpriseMaterialsStore, enterpriseDraftSha256 } from '../src/host/enterprise-materials-store.ts';
import { PersonalRetentionStore } from '../src/host/personal-retention-store.ts';
import type { LearningSourceRef } from '../src/host/learning-source-types.ts';

const evidence = path.resolve('.local/fourbase-modules/m6/implementation/sources/roots');
const meta = { kind: 'experience' as const, aliases: [], caution: null, sourceRefs: [] };
const caseRef = { type: 'case-choice' as const, caseStoreId: randomUUID(), caseId: randomUUID(), choiceId: randomUUID() };
async function fixture() {
  await fs.mkdir(evidence, { recursive: true }); const dataRoot = await fs.mkdtemp(path.join(evidence, 'records-'));
  const materials = new EnterpriseMaterialsStore(dataRoot), created = await materials.create({ title: 'Synthetic experience', body: 'Independent retained body' });
  const options = { dataRoot, materials, readSource: async (ref: LearningSourceRef) => ({ ref, title: 'exact', text: 'source', sha256: 'a'.repeat(64), status: 'available' as const }) };
  return { dataRoot, materials, created, options, store: new PersonalRetentionStore(options), file: path.join(dataRoot, 'personal-retention/records.json') };
}

test('EL10 explicit new-reference save upgrades only the outer personal ledger and compatibility close preserves old and new history', async () => {
  const f = await fixture(), id = f.created.material.id;
  const initial = await f.store.saveDraftMeta(id, { expectedRevision: 0, metadata: meta });
  const request = { operationId: randomUUID(), expectedRevision: initial.revision, target: { type: 'draft' as const, expectedMaterialVersion: f.created.material.version, expectedDraftSha256: enterpriseDraftSha256(f.created.material.draft) }, metadata: meta, personalLabel: null };
  const retained = await f.store.retain(id, request), before = await fs.readFile(f.file, 'utf8');
  assert.equal((await f.store.getRecords()).schemaVersion, 1); assert.equal(await fs.readFile(f.file, 'utf8'), before, 'GET never rewrites a legacy ledger');
  const saved = await f.store.saveDraftMeta(id, { expectedRevision: retained.item.revision, metadata: { ...meta, sourceRefs: [caseRef] } });
  const records = await f.store.getRecords(); assert.equal(records.schemaVersion, 2);
  assert.deepEqual(records.items[0].decisions[0], retained.decision, 'old requests, fingerprints and history remain unchanged');
  const closed = new PersonalRetentionStore({ ...f.options, allowNewLearningSources: false });
  const bytes = await fs.readFile(f.file, 'utf8'); assert.equal((await closed.getRecords()).schemaVersion, 2); assert.equal(await fs.readFile(f.file, 'utf8'), bytes);
  const same = await closed.saveDraftMeta(id, { expectedRevision: saved.revision, metadata: saved.draftMeta });
  assert.deepEqual(same.draftMeta.sourceRefs, [caseRef]);
  await assert.rejects(closed.saveDraftMeta(id, { expectedRevision: same.revision, metadata: { ...meta, sourceRefs: [{ ...caseRef, choiceId: randomUUID() }] } }), /learning_sources_disabled/);
  assert.deepEqual((await closed.getItem(id))?.draftMeta.sourceRefs, [caseRef]);
  const archived = await closed.archive(id, { operationId: randomUUID(), expectedRevision: same.revision, personalLabel: null });
  assert.equal(archived.item.archived, true); assert.deepEqual(archived.item.draftMeta.sourceRefs, [caseRef]);
  assert.equal((await closed.readItem(id)).content?.body, 'Independent retained body');
  const invalid = JSON.parse(await fs.readFile(f.file, 'utf8')); invalid.schemaVersion = 1; const badBytes = JSON.stringify(invalid); await fs.writeFile(f.file, badBytes);
  await assert.rejects(closed.getRecords(), /corrupt_personal_retention_records/); assert.equal(await fs.readFile(f.file, 'utf8'), badBytes);
});
