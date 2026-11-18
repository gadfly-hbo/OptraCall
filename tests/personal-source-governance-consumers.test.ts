import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ProjectStore } from '../src/host/project-store.ts';
import { EnterpriseMaterialsStore, enterpriseDraftSha256 } from '../src/host/enterprise-materials-store.ts';
import { PersonalRetentionStore } from '../src/host/personal-retention-store.ts';
import { AgentCandidateControls } from '../src/host/agent-candidate-controls.ts';
import { createAgentCandidateReader } from '../src/host/agent-candidate-reader.ts';
import { createPersonalContextReader } from '../src/host/personal-context-reader.ts';
import { CaseStore } from '../src/host/case-store.ts';
import { createCaseDecisionService } from '../src/host/case-decision-service.ts';
import { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import { SemanticContextService } from '../src/host/semantic-context-service.ts';
import { createRequirementFrameworkSources } from '../src/host/requirement-framework-sources.ts';
import { createSapMethodSources } from '../src/host/sap-method-sources.ts';
import { candidateToolName, type AgentCandidateDetails } from '../src/agent/agent-candidate.ts';
import type { PersonalContextTarget } from '../src/host/personal-context-types.ts';

const evidence = path.resolve('.local/memory-source-governance/consumers');
const body = 'R3_CONSUMER_RETAINED_EXPERIENCE_BODY';
const correction = 'R3_CONSUMER_ALLOWED_CORRECTION_ONLY_PILOT';
const forbidden = 'R3_CONSUMER_EXCLUDED_CANDIDATE_CANARY';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const context = () => ({ signal: new AbortController().signal, requestId: randomUUID(), sessionId: 'synthetic-source-consumer', toolCallId: 'read-memory', assertCurrent() {} });

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  await fs.mkdir(evidence, { recursive: true });
  const root = await fs.mkdtemp(path.join(evidence, 'root-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') });
  await projects.init(); t.after(() => projects.close());
  const project = await projects.create({ name: 'R3 synthetic consumer', configuration: { id: 'synthetic', revision: 1, name: 'Synthetic only', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' } });
  const task = await projects.createTask(project.id, { name: 'R3 source candidate' });
  const controls = new AgentCandidateControls({ dataRoot: projects.dataRoot, readTarget: async ref => { assert.equal((await candidates.read(ref)).status, 'available'); } });
  const candidates = createAgentCandidateReader({ projects, controls });
  const sessionId = randomUUID(), requestId = randomUUID(), timestamp = '2026-11-15T10:00:00.000Z';
  const details: AgentCandidateDetails = { schemaVersion: 1, type: 'optracall.agent-candidate', claim: 'agent-generated-unconfirmed',
    origin: { projectId: project.id, taskId: task.id, sessionId, requestId, toolCallId: 'candidate-call' }, createdAt: timestamp,
    content: { kind: 'experience', title: 'Synthetic origin', bodyMd: forbidden, aliases: [], scope: null, caution: null }, sourceRefs: [] };
  const entries = [
    { type: 'session', version: 3, id: sessionId, timestamp, cwd: path.join(project.rootPath, '020_clean') },
    { type: 'custom', id: 'started', parentId: null, timestamp, customType: 'optracall.run', data: { phase: 'started', requestId, sessionId, kind: 'prompt' } },
    { type: 'message', id: 'call', parentId: 'started', timestamp, message: { role: 'assistant', content: [{ type: 'toolCall', id: 'candidate-call', name: candidateToolName, arguments: { content: details.content, sourceRefs: [] } }] } },
    { type: 'message', id: 'result', parentId: 'call', timestamp, message: { role: 'toolResult', toolName: candidateToolName, toolCallId: 'candidate-call', details, content: [{ type: 'text', text: 'Legacy fixture only.' }], isError: false, timestamp: Date.parse(timestamp) } },
    { type: 'custom', id: 'settled', parentId: 'result', timestamp, customType: 'optracall.run', data: { phase: 'settled', requestId, sessionId, outcome: 'completed' } },
  ];
  const native = path.join(task.sessionDirectory, 'source_' + sessionId + '.jsonl');
  await fs.writeFile(native, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  const candidate = (await candidates.lookup()).rows.find(row => row.ref)!.ref!;
  const materials = new EnterpriseMaterialsStore(projects.dataRoot);
  const retention = new PersonalRetentionStore({ dataRoot: projects.dataRoot, materials, readSource: async ref => {
    assert.equal(ref.type, 'agent-candidate');
    if (ref.type !== 'agent-candidate') throw new Error('unexpected fixture source');
    const row = await candidates.read(ref.candidate);
    assert.equal(row.status, 'available'); assert.ok(row.details);
    return { ref, title: row.details.content.title, text: row.details.content.bodyMd, sha256: candidate.expectedDetailsSha256, status: 'available' };
  } });
  const material = await materials.create({ title: 'Independent experience', body });
  const decisionId = randomUUID();
  const retained = await retention.retain(material.material.id, { operationId: decisionId, expectedRevision: 0,
    target: { type: 'draft', expectedMaterialVersion: material.material.version, expectedDraftSha256: enterpriseDraftSha256(material.material.draft) },
    metadata: { kind: 'experience', aliases: [], caution: null, sourceRefs: [{ type: 'agent-candidate', candidate }] }, personalLabel: null });
  const target: PersonalContextTarget = { type: 'retained', ...retained.decision!.contentRef!, decisionId, expectedBodySha256: retained.decision!.bodySha256! };
  const personal = createPersonalContextReader({ projects, retention, controls });
  const before = await personal.read({ target });
  await controls.apply({ operationId: randomUUID(), target: candidate, action: 'correct', note: correction });
  const cases = new CaseStore({ dataRoot: projects.dataRoot }); await cases.initialize(); t.after(async () => cases.close());
  const caseRecord = cases.createCase({ operationId: randomUUID(), title: 'R3 consumer case' });
  const caseService = createCaseDecisionService({ cases, projects, personalContext: personal, mutate: async use => use(), assertActive: current => assert.equal(current.archivedAt, null) });
  const semantic = new SemanticContextService({ projects, data: new ProjectDataContextStore({ dataRoot: projects.dataRoot, projects }), enterprise: materials, cases, personal });
  return { root, project, task, native, candidate, controls, materials, retention, personal, target, before, cases, caseRecord, caseService, semantic };
}

test('R3 shared Case source includes the current candidate reminder without changing the retained experience governance', async t => {
  const f = await fixture(t);
  const provided = await f.caseService.source(f.caseRecord.id, { target: { type: 'personal', target: f.target } });
  assert.equal(provided.status, 'available'); assert.ok(provided.text);
  assert.match(provided.text, new RegExp(correction));
  assert.match(provided.text, new RegExp(body)); assert.doesNotMatch(provided.text, new RegExp(forbidden));
  assert.equal(provided.sha256, sha(provided.text));
  assert.deepEqual((provided.current as { provided: { governance: unknown } }).provided.governance, f.before.details.items[0]!.governance);
  const state = await f.controls.readState(f.candidate);
  await f.controls.apply({ operationId: randomUUID(), target: f.candidate, action: 'exclude', note: null, expectedTargetRevision: state.targetRevision });
  const excluded = await f.caseService.source(f.caseRecord.id, { target: { type: 'personal', target: f.target } });
  assert.equal(excluded.status, 'available'); assert.match(excluded.text!, new RegExp(body));
  assert.match(excluded.text!, /排除|excluded/); assert.doesNotMatch(excluded.text!, new RegExp(correction + '|' + forbidden));
  assert.equal((await f.retention.readItem(f.target.type === 'retained' ? f.target.materialId : '', f.target.type === 'retained' ? f.target.decisionId : '')).content!.bodySha256, sha(body));
});

test('R3 shared Semantic and requirements reads carry source reminders while preserving the independent experience hash', async t => {
  const f = await fixture(t), target = { kind: 'personal' as const, target: f.target };
  const semantic = await f.semantic.query(f.project.id, f.task.id, { action: 'read', target });
  assert.match(semantic.items[0]!.body!, new RegExp(correction));
  assert.deepEqual(semantic.items[0]!.governance, f.before.details.items[0]!.governance);
  const sources = createRequirementFrameworkSources({ semantic: () => f.semantic, experienceLearningEnabled: true });
  const operation = sources.begin(), read = await operation.read('read', { target }, context());
  assert.match(read.content[0]!.text, new RegExp(correction)); assert.doesNotMatch(read.content[0]!.text, new RegExp(forbidden));
  assert.equal(operation.references()[0]!.digest, sha(body));
  const prior = await f.retention.getItem(f.target.type === 'retained' ? f.target.materialId : ''); assert.ok(prior);
  await f.retention.archive(prior.materialId, { operationId: randomUUID(), expectedRevision: prior.revision, personalLabel: null });
  const archived = await sources.begin().read('read', { target }, context());
  assert.doesNotMatch(JSON.stringify(archived), new RegExp(body + '|' + correction));
});

test('R3 SAP public source port carries the actual retained-experience reader text and leaves its source native unchanged', async t => {
  const f = await fixture(t), before = await fs.readFile(f.native);
  const sources = await createSapMethodSources({ projectId: f.project.id, taskId: f.task.id, extractionId: randomUUID(), sessionFile: f.native,
    sessionDirectory: f.task.sessionDirectory, cwd: path.join(f.project.rootPath, '020_clean'), personal: async (_action, input, call) => {
      const result = await f.personal.read(input as { target: PersonalContextTarget }, { signal: call.signal });
      return { content: [{ type: 'text', text: result.text }], details: result.details };
    } });
  const result = await sources.read('read-memory', { input: { target: f.target } }, context());
  assert.match(result.content[0]!.text, new RegExp(correction)); assert.match(result.content[0]!.text, new RegExp(body));
  assert.doesNotMatch(result.content[0]!.text, new RegExp(forbidden));
  assert.deepEqual((result.details as { items: { governance: unknown }[] }).items[0]!.governance, f.before.details.items[0]!.governance);
  await sources.assertUnchanged(); assert.deepEqual(await fs.readFile(f.native), before);
});

test('R3 explicit prepare delivers the reminder with unchanged exact experience ranges and body identity', async t => {
  const f = await fixture(t), input = [{ target: f.target }];
  const prepared = await f.personal.prepare(input);
  assert.match(prepared.text, new RegExp(correction)); assert.match(prepared.text, new RegExp(body));
  assert.deepEqual(input, [{ target: f.target }]);
  assert.deepEqual(prepared.details.items[0]!.target, f.target);
  assert.deepEqual(prepared.details.items[0]!.range, { start: 0, end: body.length });
  assert.deepEqual(prepared.details.items[0]!.governance, f.before.details.items[0]!.governance);
});
