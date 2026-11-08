import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestHost } from './fixtures/host-process.ts';
import { readJson } from './fixtures/joint-context.ts';

test('M31 native candidate discovery is a read-only personal-page query and never initializes human controls', { timeout: 30_000 }, async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const result = await readJson(await host.request('/api/personal-retention/candidates/lookup'));
  assert.deepEqual(result.rows, []); assert.deepEqual(result.issues, []); assert.equal(result.partial, false); assert.equal(result.controlsAvailable, true);
  const { access } = await import('node:fs/promises');
  await assert.rejects(access(host.dataRoot + '/personal-agent-controls'));
});

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { candidateToolName, type AgentCandidateDetails } from '../src/agent/agent-candidate.ts';
async function nativeFixture(host: Awaited<ReturnType<typeof startTestHost>>, outcome: 'cancelled' | 'failed' | null = 'cancelled') {
  await readJson(await host.request('/api/configuration', 'PUT', { name: '合成', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1', model: 'synthetic', apiKey: 'synthetic-only' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: '候选原项目' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '候选原任务' }), 201);
  const sessionId = randomUUID(), requestId = randomUUID(), timestamp = new Date().toISOString(), toolCallId = 'candidate-call';
  const details: AgentCandidateDetails = { schemaVersion: 1, type: 'optracall.agent-candidate', claim: 'agent-generated-unconfirmed', origin: { projectId: project.id, taskId: task.id, sessionId, requestId, toolCallId }, createdAt: timestamp, content: { kind: 'knowledge', title: '应核对分母', bodyMd: '正文独有词：合成退款口径。效果未验证。', aliases: ['口径'], scope: '合成工作范围', caution: '不证明因果' }, sourceRefs: [] };
  const input = { content: details.content, sourceRefs: details.sourceRefs };
  const lines: Record<string, unknown>[] = [
    { type: 'session', version: 3, id: sessionId, timestamp, cwd: path.join(project.rootPath, '020_clean') },
    { type: 'custom', id: 'started', parentId: null, timestamp, customType: 'optracall.run', data: { phase: 'started', requestId, sessionId, kind: 'prompt' } },
    { type: 'message', id: 'assistant-call', parentId: 'started', timestamp, message: { role: 'assistant', content: [{ type: 'toolCall', id: toolCallId, name: candidateToolName, arguments: input }] } },
    { type: 'message', id: 'candidate-result', parentId: 'assistant-call', timestamp, message: { role: 'toolResult', toolCallId, toolName: candidateToolName, content: [{ type: 'text', text: '已接受，待保存' }], details, isError: false, timestamp: Date.now() } },
  ];
  if (outcome) lines.push({ type: 'custom', id: 'settled', parentId: 'candidate-result', timestamp, customType: 'optracall.run', data: { phase: 'settled', requestId, sessionId, outcome } });
  const file = path.join(task.sessionDirectory, `original_${sessionId}.jsonl`);
  const bytes = Buffer.from(lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  await fs.writeFile(file, bytes);
  return { project, task, sessionId, requestId, details, lines, file, bytes };
}
const prefix = '/api/personal-retention/candidates';

test('M31 saved candidate survives parent cancellation, has exact origin, fork deduplication and optional human controls', { timeout: 30_000 }, async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const f = await nativeFixture(host);
  const fork = [...f.lines]; fork[0] = { ...fork[0], id: randomUUID(), parentSession: f.file };
  const forkFile = path.join(f.task.sessionDirectory, 'fork.jsonl'); await fs.writeFile(forkFile, fork.map(l => JSON.stringify(l)).join('\n') + '\n');
  const result = await readJson(await host.request(`${prefix}/lookup`));
  assert.equal(result.rows.length, 1, JSON.stringify(result)); const row = result.rows[0];
  assert.equal(row.parentState, 'cancelled'); assert.equal(row.status, 'available'); assert.equal(row.details.claim, 'agent-generated-unconfirmed');
  assert.equal(row.locations.length, 2); assert.equal(row.ref.originSessionId, f.sessionId); assert.equal(row.ref.entryId, 'candidate-result');
  assert.equal(row.details.content.bodyMd, f.details.content.bodyMd); assert.equal(row.control.targetRevision, 0);
  assert.equal((await readJson(await host.request(`${prefix}/lookup?query=${encodeURIComponent('正文独有词')}`))).rows.length, 0);
  assert.equal((await readJson(await host.request(`${prefix}/lookup?query=${encodeURIComponent('正文独有词')}&includeBody=true`))).rows.length, 1);
  const intent = { operationId: randomUUID(), target: row.ref, action: 'bookmark', note: null, expectedTargetRevision: 0 };
  const first = await readJson(await host.request(`${prefix}/controls`, 'POST', intent), 201);
  assert.equal(first.state.bookmarked, true);
  const manual = await readJson(await host.request('/api/personal-retention/lookup'));
  assert.equal(manual.complete, true, JSON.stringify(manual)); assert.deepEqual(manual.items, []);
  const correction = await readJson(await host.request(`${prefix}/controls`, 'POST', { operationId: randomUUID(), target: row.ref, action: 'correct', note: '仅为人的意见' }), 201);
  assert.equal(correction.state.notes[0].note, '仅为人的意见');
  const original = await readJson(await host.request(`${prefix}/read`, 'POST', { ref: row.ref }));
  assert.equal(original.details.content.bodyMd, f.details.content.bodyMd);
  const conflict = await host.request(`${prefix}/controls`, 'POST', { ...intent, operationId: randomUUID(), action: 'exclude' });
  assert.equal(conflict.status, 409);
  await readJson(await host.request(`${prefix}/controls`, 'POST', { ...intent, operationId: randomUUID(), action: 'exclude', expectedTargetRevision: 2 }), 201);
  assert.equal((await readJson(await host.request(`${prefix}/lookup`))).rows.length, 0);
  assert.equal((await readJson(await host.request(`${prefix}/lookup?view=excluded`))).rows.length, 1);
  await fs.unlink(f.file); await fs.unlink(forkFile);
  const unread = (await readJson(await host.request(`${prefix}/lookup?view=excluded`))).rows[0];
  assert.equal(unread.status, 'unknown'); assert.equal(unread.details, null); assert.equal(unread.parentState, 'unknown'); assert.deepEqual(unread.locations, []);
  await readJson(await host.request(`${prefix}/controls`, 'POST', { ...intent, operationId: randomUUID(), action: 'unbookmark', expectedTargetRevision: 3 }), 201);
  await readJson(await host.request(`${prefix}/controls`, 'POST', { ...intent, operationId: randomUUID(), action: 'restore', expectedTargetRevision: 4 }), 201);
  assert.equal((await readJson(await host.request(`${prefix}/lookup`))).rows[0].status, 'unknown');
  assert.equal((await host.request(`${prefix}/controls`, 'POST', { ...intent, operationId: randomUUID(), expectedTargetRevision: 5 })).status, 409);
  const replay = await readJson(await host.request(`${prefix}/controls`, 'POST', intent));
  assert.equal(replay.event.targetRevision, 1); assert.equal(replay.state.targetRevision, 5); assert.equal(replay.state.bookmarked, false);
  assert.equal((await readJson(await host.request(`${prefix}/operations/${intent.operationId}`))).state.targetRevision, 5);
});

test('M31 parent failure or unknown do not hide valid saved candidates; malformed/error/call-mismatch remain abnormal', { timeout: 30_000 }, async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const f = await nativeFixture(host, 'failed');
  assert.equal((await readJson(await host.request(`${prefix}/lookup`))).rows[0].parentState, 'failed');
  await fs.writeFile(f.file, f.lines.slice(0, -1).map(l => JSON.stringify(l)).join('\n') + '\n');
  assert.equal((await readJson(await host.request(`${prefix}/lookup`))).rows[0].parentState, 'unknown');
  const changed = structuredClone(f.lines); const last = changed[3].message as Record<string, unknown>; last.isError = true;
  await fs.writeFile(f.file, changed.map(l => JSON.stringify(l)).join('\n') + '\n');
  assert.equal((await readJson(await host.request(`${prefix}/lookup`))).rows.length, 0);
  assert.equal((await readJson(await host.request(`${prefix}/lookup?view=anomalies`))).rows[0].reason, 'candidate_tool_error');
  await fs.writeFile(f.file, f.bytes.subarray(0, f.bytes.length - 1));
  const incomplete = await readJson(await host.request(`${prefix}/lookup`));
  assert.equal(incomplete.rows.length, 0); assert.equal(incomplete.issues[0].code, 'native_snapshot_incomplete');
  assert.deepEqual(await fs.readFile(f.file), f.bytes.subarray(0, f.bytes.length - 1));
});

test('M31 capacity errors are precise and neither create nor rebuild missing M3 manual history', { timeout: 30_000 }, async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const f = await nativeFixture(host), row = (await readJson(await host.request(`${prefix}/lookup`))).rows[0];
  const input = { operationId: randomUUID(), target: row.ref, action: 'bookmark', note: null, expectedTargetRevision: 0 };
  await readJson(await host.request(`${prefix}/controls`, 'POST', input), 201);
  await assert.rejects(fs.access(path.join(host.dataRoot, 'personal-retention')));
  const material = await readJson(await host.request('/api/enterprise-materials', 'POST', { title: '人工资料', body: '保留人工资料丢失保护' }), 201);
  await readJson(await host.request(`/api/personal-retention/items/${material.material.id}/draft`, 'POST', { expectedRevision: 0, metadata: { kind: 'knowledge', aliases: [], caution: null, sourceRefs: [] } }));
  const manualFile = path.join(host.dataRoot, 'personal-retention/records.json'), manualBytes = await fs.readFile(manualFile);
  await fs.unlink(manualFile);
  await readJson(await host.request(`${prefix}/controls`, 'POST', { ...input, operationId: randomUUID(), action: 'unbookmark', expectedTargetRevision: 1 }), 201);
  const manual = await readJson(await host.request('/api/personal-retention/lookup'));
  assert.equal(manual.complete, false); assert.ok(manual.issues.some((i: { code: string }) => i.code === 'personal_records_missing'));
  await assert.rejects(fs.access(manualFile)); assert.ok(manualBytes.length > 0);
  const file = path.join(host.dataRoot, 'personal-agent-controls/records.json');
  const records = JSON.parse(await fs.readFile(file, 'utf8'));
  for (;;) {
    const event = { operationId: randomUUID(), target: row.ref, action: 'correct', note: 'x'.repeat(4000), createdAt: new Date().toISOString(), targetRevision: records.events.length + 1 };
    const next = { ...records, events: [...records.events, event] };
    if (Buffer.byteLength(JSON.stringify(next) + '\n') > 2 * 1024 * 1024) break;
    records.events.push(event);
  }
  const before = Buffer.from(JSON.stringify(records) + '\n'); await fs.writeFile(file, before);
  const response = await host.request(`${prefix}/controls`, 'POST', { operationId: randomUUID(), target: row.ref, action: 'correct', note: 'x'.repeat(4000) });
  const error = await readJson(response, 413); assert.equal(error.code, 'candidate_controls_capacity_exceeded'); assert.match(error.message, /容量/);
  assert.deepEqual(await fs.readFile(file), before); await assert.rejects(fs.access(manualFile));
});
