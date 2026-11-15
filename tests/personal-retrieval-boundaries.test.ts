import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EnterpriseMaterialsStore, enterpriseDraftSha256 } from '../src/host/enterprise-materials-store.ts';
import { PersonalRetentionStore } from '../src/host/personal-retention-store.ts';
import { ProjectStore } from '../src/host/project-store.ts';
import { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import { createProjectDataContextReferences } from '../src/host/project-data-context-references.ts';
import { createDecisionBoardStore } from '../extensions/business-plugins/decision-board/storage/store.ts';
import { createPersonalSourceReader } from '../src/host/personal-retention-sources.ts';
import { AgentCandidateControls } from '../src/host/agent-candidate-controls.ts';
import { createPersonalContextReader } from '../src/host/personal-context-reader.ts';
import { createPersonalLookup } from '../src/host/personal-retention-lookup.ts';
import type { LearningSourceRef } from '../src/host/learning-source-types.ts';

// Characterize the current two public contracts before considering reuse. These
// Unicode examples are baseline differences, not a permanent product policy.
async function fixture(t: TestContext) {
  const roots = path.resolve('.local/memory-retrieval-boundaries/test-roots');
  await fs.mkdir(roots, { recursive: true }); const root = await fs.mkdtemp(path.join(roots, 'contracts-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') }); await projects.init();
  const enterprise = new EnterpriseMaterialsStore(projects.dataRoot);
  const references = createProjectDataContextReferences({ dataRoot: projects.dataRoot, projects, enterpriseMaterials: enterprise });
  const dataContext = new ProjectDataContextStore({ dataRoot: projects.dataRoot, projects, validateReferences: references.validate });
  const board = createDecisionBoardStore({ root: path.join(root, 'board') }); await board.init();
  t.after(async () => { board.close(); await projects.close(); });
  const readSource = createPersonalSourceReader({ enterprise, projects, dataContext, board });
  const retention = new PersonalRetentionStore({ dataRoot: projects.dataRoot, materials: enterprise, readSource });
  const controls = new AgentCandidateControls({ dataRoot: projects.dataRoot, readTarget: async ref => { await agent.read({ target: { type: 'agent-candidate', candidate: ref } }); } });
  const agent = createPersonalContextReader({ projects, retention, controls });
  const human = createPersonalLookup({ personal: retention, enterprise, projects, dataContext, readSource });
  async function retain(title: string, body = 'SYNTHETIC_BODY', sourceRefs: LearningSourceRef[] = []) {
    const created = await enterprise.create({ title, body }), operationId = randomUUID();
    const saved = await retention.retain(created.material.id, { operationId, expectedRevision: 0,
      target: { type: 'draft', expectedMaterialVersion: created.material.version, expectedDraftSha256: enterpriseDraftSha256(created.material.draft) },
      metadata: { kind: 'knowledge', aliases: [], caution: null, sourceRefs }, personalLabel: null });
    return { created, target: { type: 'retained' as const, storeId: created.storeId, materialId: created.material.id, decisionId: operationId,
      revisionId: saved.decision!.contentRef!.revisionId, expectedBodySha256: saved.decision!.bodySha256! } };
  }
  return { root, enterprise, retention, agent, human, retain };
}

test('R2 baseline: public readers retain distinct Unicode matching and literal UTF-16 hit positions', async t => {
  const f = await fixture(t);
  for (const title of ['ς', 'ſ', 'İ']) await f.retain(title);
  for (const [query, agentCount, humanCount] of [['σ', 0, 1], ['s', 0, 1], ['i', 1, 0]] as const) {
    assert.equal((await f.agent.find({ query })).details.items.length, agentCount, `Agent query ${query}`);
    assert.equal((await f.human({ query, category: 'knowledge' })).total, humanCount, `Human query ${query}`);
  }
  await f.retain('😀[x].+ suffix');
  assert.equal((await f.agent.find({ query: '[x].+' })).details.items.length, 1);
  const literal = await f.human({ query: '[x].+', category: 'knowledge' });
  assert.equal(literal.total, 1); assert.deepEqual(literal.items[0]?.matches, [{ field: 'title', start: 2, end: 7 }]);
  assert.equal((await f.human({ query: '.*', category: 'knowledge' })).total, 0, 'query metacharacters stay literal');
});

test('R2 boundaries: Agent catalog keeps the exact retained version while human body and draft discovery are explicit', async t => {
  const f = await fixture(t), saved = await f.retain('retained-boundary', 'ONLY_RETAINED_BODY');
  const current = await f.enterprise.get(saved.created.material.id);
  await f.enterprise.update(current.material.id, current.material.version, { title: 'draft-boundary', body: 'ONLY_DRAFT_BODY' });
  const catalog = await f.agent.find({ query: 'retained-boundary' });
  assert.equal(catalog.details.items.length, 1); assert.deepEqual(catalog.details.items[0]?.target, saved.target);
  assert.doesNotMatch(catalog.text, /ONLY_RETAINED_BODY|ONLY_DRAFT_BODY/);
  assert.equal((await f.agent.find({ query: 'ONLY_RETAINED_BODY' })).details.items.length, 0);
  assert.equal((await f.human({ query: 'ONLY_RETAINED_BODY', category: 'knowledge' })).total, 0);
  const body = await f.human({ query: 'ONLY_RETAINED_BODY', category: 'knowledge', includeBody: true });
  assert.equal(body.total, 1); assert.equal(body.items[0]?.bodyPreview, 'ONLY_RETAINED_BODY');
  assert.deepEqual(body.items[0]?.matches, [{ field: 'body', start: 0, end: 18 }]);
  assert.equal((await f.agent.find({ query: 'draft-boundary' })).details.items.length, 0);
  assert.equal((await f.human({ query: 'draft-boundary', category: 'knowledge' })).total, 0);
  const drafts = await f.human({ query: 'draft-boundary', category: 'knowledge', includeDrafts: true });
  assert.equal(drafts.total, 1); assert.equal(drafts.items[0]?.personalState, 'draft');
  assert.equal(drafts.items[0]?.bodyPreview, 'ONLY_DRAFT_BODY');
});

test('R2 boundaries: Agent continuation and human numbered pages keep their own limits and result identities', async t => {
  const f = await fixture(t);
  for (let index = 0; index < 21; index++) await f.retain(`page-${String(index).padStart(2, '0')}`);
  const first = await f.agent.find(), next = await f.agent.find({ continuation: first.details.continuation! });
  assert.equal(first.details.items.length, 20); assert.ok(first.details.continuation);
  assert.equal(next.details.items.length, 1); assert.equal(next.details.continuation, null);
  const keys = [...first.details.items, ...next.details.items].map(item => JSON.stringify(item.target));
  assert.equal(new Set(keys).size, 21);
  const human = await f.human({ category: 'knowledge', page: 2, pageSize: 20 });
  assert.equal(human.total, 21); assert.equal(human.page, 2); assert.equal(human.items.length, 1);
  assert.equal((await f.agent.find({ pageSize: 50 })).details.items.length, 21);
  assert.equal((await f.human({ category: 'knowledge', pageSize: 100 })).items.length, 21);
  await assert.rejects(f.agent.find({ pageSize: 51 }), { code: 'invalid_personal_context_find' });
  await assert.rejects(f.human({ pageSize: 101 }), { code: 'invalid_personal_lookup_page' });
  await f.retain('new-catalog-member');
  await assert.rejects(f.agent.find({ continuation: first.details.continuation! }), { code: 'personal_context_continuation_changed' });
});

test('R2 boundaries: source damage does not turn Agent metadata lookup into the human source-completeness contract', async t => {
  const f = await fixture(t), original = await f.enterprise.create({ title: 'Exact source', body: 'SYNTHETIC_SOURCE' });
  const published = await f.enterprise.enable(original.material.id, original.material.version), revision = published.material.revisions[0]!;
  await f.retain('source-boundary-note', 'Independent personal text', [{ type: 'enterprise', storeId: original.storeId, materialId: original.material.id, revisionId: revision.revisionId }]);
  await fs.writeFile(revision.bodyPath, 'Synthetic damage');
  const catalog = await f.agent.find({ query: 'source-boundary-note' });
  assert.equal(catalog.details.items.length, 1); assert.equal(catalog.details.partial, false); assert.deepEqual(catalog.details.issues, []);
  assert.doesNotMatch(catalog.text, /Independent personal text|SYNTHETIC_SOURCE/);
  const human = await f.human({ query: 'source-boundary-note', category: 'knowledge' });
  assert.equal(human.total, 1); assert.equal(human.complete, false); assert.equal(human.items[0]?.bodyPreview, 'Independent personal text');
  assert.ok(human.issues.some(issue => issue.code === 'enterprise_source_changed'));
  const absent = await f.human({ query: 'not-matching-anywhere', category: 'knowledge' });
  assert.equal(absent.total, 0); assert.equal(absent.complete, false, 'source failure is not complete evidence of absence');
});
