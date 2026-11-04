import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { SemanticContextService } from '../src/host/semantic-context-service.ts';
import { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import { CaseStore } from '../src/host/case-store.ts';
import { ProjectStore } from '../src/host/project-store.ts';
import { AgentCandidateControls } from '../src/host/agent-candidate-controls.ts';
import { createAgentCandidateReader } from '../src/host/agent-candidate-reader.ts';
import { createPersonalSourceReader } from '../src/host/personal-retention-sources.ts';
import { EnterpriseMaterialsStore, enterpriseDraftSha256 } from '../src/host/enterprise-materials-store.ts';
import { PersonalRetentionStore } from '../src/host/personal-retention-store.ts';
import { createPersonalContextReader } from '../src/host/personal-context-reader.ts';
import { agentCandidateDetailsSha256, candidateToolName, type AgentCandidateDetails } from '../src/agent/agent-candidate.ts';
import { createNativeSnapshotReadBudget } from '../src/host/native-session-snapshot.ts';

test('EL02/05 exact native candidate sources expose current governance, while Agent indirect reads cannot resupply an excluded candidate', async t => {
  const roots = path.resolve('.local/fourbase-modules/m6/implementation/sources/roots'); await fs.mkdir(roots, { recursive: true });
  const root = await fs.mkdtemp(path.join(roots, 'native-')), dataRoot = path.join(root, 'data'), projects = new ProjectStore({ dataRoot, projectsRoot: path.join(root, 'projects') });
  await projects.init(); t.after(() => projects.close());
  const project = await projects.create({ name: 'Synthetic source history', configuration: { id: 'synthetic', revision: 1, name: 'synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' } });
  const task = await projects.createTask(project.id, { name: 'Original candidate' }), sessionId = randomUUID(), requestId = randomUUID(), timestamp = '2026-11-04T01:00:00.000Z';
  const details = { schemaVersion: 1 as const, type: 'optracall.agent-candidate' as const, claim: 'agent-generated-unconfirmed' as const, origin: { projectId: project.id, taskId: task.id, sessionId, requestId, toolCallId: 'candidate-call' }, createdAt: timestamp, content: { kind: 'experience' as const, title: 'SECRET_SOURCE_TITLE', bodyMd: 'SECRET_CANDIDATE_BODY', aliases: [], scope: 'SECRET_SCOPE', caution: null }, sourceRefs: [] };
  const bytes = Buffer.from([
    { type: 'session', version: 3, id: sessionId, timestamp, cwd: path.join(project.rootPath, '020_clean') },
    { type: 'custom', id: 'started', parentId: null, timestamp, customType: 'optracall.run', data: { phase: 'started', requestId, sessionId, kind: 'prompt' } },
    { type: 'message', id: 'call', parentId: 'started', timestamp, message: { role: 'assistant', content: [{ type: 'toolCall', id: 'candidate-call', name: candidateToolName, arguments: { content: details.content, sourceRefs: [] } }] } },
    { type: 'message', id: 'result', parentId: 'call', timestamp, message: { role: 'toolResult', toolName: candidateToolName, toolCallId: 'candidate-call', details, content: [{ type: 'text', text: 'accepted' }], isError: false, timestamp: Date.parse(timestamp) } },
    { type: 'message', id: 'source-reply', parentId: 'result', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: 'Exact native reply source' }] } },
  ].map(line => JSON.stringify(line)).join('\n') + '\n');
  const file = path.join(task.sessionDirectory, sessionId + '.jsonl'); await fs.writeFile(file, bytes);
  const controls = new AgentCandidateControls({ dataRoot, readTarget: async ref => { await candidates.read(ref); } }), candidates = createAgentCandidateReader({ projects, controls });
  const candidate = { projectId: project.id, taskId: task.id, originSessionId: sessionId, entryId: 'result', toolCallId: 'candidate-call', expectedDetailsSha256: agentCandidateDetailsSha256(details) };
  const ref = { type: 'agent-candidate' as const, candidate }, materials = new EnterpriseMaterialsStore(dataRoot), unreachable = () => { throw new Error('unexpected_source_domain'); };
  const reader = createPersonalSourceReader({ enterprise: materials, projects, candidates, dataContext: { readCitationEvidence: async () => unreachable() }, board: { getTask: unreachable, getItem: unreachable, getFeedbackRevision: unreachable } });
  const nativeRef = { type: 'native-reply' as const, projectId: project.id, taskId: task.id, sessionId, messageId: 'source-reply', expectedTextSha256: createHash('sha256').update('Exact native reply source').digest('hex') };
  const exhaustedReply = createNativeSnapshotReadBudget(); exhaustedReply.files = 0;
  await assert.rejects(reader(nativeRef, { audience: 'agent', budget: exhaustedReply })); assert.equal(exhaustedReply.files, 0);
  const human = await reader(ref); assert.equal(human.text, 'SECRET_CANDIDATE_BODY'); assert.equal(human.candidateGovernance?.excluded, false);
  await controls.apply({ operationId: randomUUID(), target: candidate, action: 'correct', note: '人的独立纠正', });
  assert.equal((await reader(ref)).candidateGovernance?.notes[0]?.note, '人的独立纠正');
  const state = await controls.readState(candidate); await controls.apply({ operationId: randomUUID(), target: candidate, action: 'exclude', note: null, expectedTargetRevision: state.targetRevision });
  assert.equal((await reader(ref, { audience: 'human' })).text, 'SECRET_CANDIDATE_BODY', 'human exact historical view remains available');
  const semantics = new SemanticContextService({ projects, data: new ProjectDataContextStore({ dataRoot, projects }), enterprise: materials, cases: new CaseStore({ dataRoot }), readSource: reader });
  const semanticQuery = { action: 'read' as const, target: { kind: 'source' as const, source: ref } };
  const humanSemantic = await semantics.query(project.id, task.id, semanticQuery, { audience: 'human' });
  assert.equal(humanSemantic.items[0]?.state, 'excluded');
  assert.equal(humanSemantic.items[0]?.body, 'SECRET_CANDIDATE_BODY', 'the auxiliary reader preserves original human historical access');
  const agentSemantic = await semantics.query(project.id, task.id, semanticQuery, { audience: 'agent' });
  assert.equal(agentSemantic.items[0]?.body, null); assert.doesNotMatch(JSON.stringify(agentSemantic), /SECRET_/);
  const agent = await reader(ref, { audience: 'agent', budget: createNativeSnapshotReadBudget() });
  assert.equal(agent.status, 'excluded'); assert.equal(agent.text, null); assert.equal(agent.candidateGovernance?.excluded, true); assert.doesNotMatch(JSON.stringify(agent), /SECRET_/);
  const created = await materials.create({ title: 'Independent personal experience', body: 'INDEPENDENT_M3_BODY' }), retention = new PersonalRetentionStore({ dataRoot, materials, readSource: reader });
  const kept = await retention.retain(created.material.id, { operationId: randomUUID(), expectedRevision: 0, target: { type: 'draft', expectedMaterialVersion: created.material.version, expectedDraftSha256: enterpriseDraftSha256(created.material.draft) }, metadata: { kind: 'experience', aliases: [], caution: null, sourceRefs: [ref] }, personalLabel: null });
  const personal = createPersonalContextReader({ projects, retention, controls }), target = { type: 'retained' as const, storeId: kept.decision!.contentRef!.storeId, materialId: created.material.id, decisionId: kept.decision!.operationId, revisionId: kept.decision!.contentRef!.revisionId, expectedBodySha256: kept.decision!.bodySha256! };
  assert.match((await personal.read({ target })).text, /INDEPENDENT_M3_BODY/, 'independent retained text does not cascade with source exclusion');
  const indirect = await personal.read({ target, part: 'source', sourceIndex: 0 }); assert.doesNotMatch(JSON.stringify(indirect), /SECRET_/); assert.match(indirect.text, /excluded/);
  await assert.rejects(personal.read({ target: { type: 'agent-candidate', candidate } }), /personal_context_excluded/);
  const excluded = await controls.readState(candidate); await controls.apply({ operationId: randomUUID(), target: candidate, action: 'restore', note: null, expectedTargetRevision: excluded.targetRevision });
  const restoredSource = await personal.read({ target, part: 'source', sourceIndex: 0 });
  assert.match(restoredSource.text, /SECRET_CANDIDATE_BODY/); assert.match(restoredSource.text, /人的独立纠正/, 'source reader discloses current correction separately from original native text');
  assert.deepEqual(await fs.readFile(file), bytes, 'native bytes and exact candidate identity are untouched');
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(reader(ref, { signal: aborted.signal }));
  const v2SessionId = randomUUID(), v2Details: AgentCandidateDetails = { ...details, schemaVersion: 2, origin: { ...details.origin, sessionId: v2SessionId }, content: { ...details.content, title: 'Derived experience', bodyMd: 'Derived native text' }, sourceRefs: [ref] };
  const v2Lines = bytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
  v2Lines[0].id = v2SessionId; v2Lines[1].data.sessionId = v2SessionId;
  v2Lines[2].message.content[0].arguments = { content: v2Details.content, sourceRefs: [ref] }; v2Lines[3].message.details = v2Details;
  const v2Bytes = Buffer.from(v2Lines.map(line => JSON.stringify(line)).join('\n') + '\n'), v2File = path.join(task.sessionDirectory, v2SessionId + '.jsonl'); await fs.writeFile(v2File, v2Bytes);
  const v2 = await candidates.read({ ...candidate, originSessionId: v2SessionId, expectedDetailsSha256: agentCandidateDetailsSha256(v2Details) });
  assert.equal(v2.status, 'available'); assert.equal(v2.details?.schemaVersion, 2); assert.deepEqual(v2.details?.sourceRefs, [ref]);
  const restored = await controls.readState(candidate); await controls.apply({ operationId: randomUUID(), target: candidate, action: 'exclude', note: null, expectedTargetRevision: restored.targetRevision });
  const candidateSource = await personal.read({ target: { type: 'agent-candidate', candidate: v2.ref! }, part: 'source', sourceIndex: 0 });
  assert.match(candidateSource.text, /excluded/); assert.doesNotMatch(JSON.stringify(candidateSource), /SECRET_/);
  const exhausted = createNativeSnapshotReadBudget(); exhausted.files = 0;
  await assert.rejects(reader(ref, { audience: 'agent', budget: exhausted }), /candidate_source_unknown/); assert.equal(exhausted.files, 0);
  assert.deepEqual(await fs.readFile(v2File), v2Bytes); assert.deepEqual(await fs.readFile(file), bytes);
});
