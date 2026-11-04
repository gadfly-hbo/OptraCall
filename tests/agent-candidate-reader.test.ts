import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectStore, type ProjectRecord, type TaskRecord } from '../src/host/project-store.ts';
import { AgentCandidateControls } from '../src/host/agent-candidate-controls.ts';
import { createAgentCandidateReader } from '../src/host/agent-candidate-reader.ts';
import { candidateToolName, type AgentCandidateDetails } from '../src/agent/agent-candidate.ts';
import { nativeSnapshotLimit } from '../src/host/native-session-snapshot.ts';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const roots = path.resolve('.local/fourbase-modules/m31/implementation/native/edge-roots');
  await fs.mkdir(roots, { recursive: true });
  const root = await fs.mkdtemp(path.join(roots, 'reader-'));
  const dataRoot = path.join(root, 'data');
  const projects = new ProjectStore({ dataRoot, projectsRoot: path.join(root, 'projects') });
  await projects.init(); t.after(() => projects.close());
  const project = await projects.create({ name: '候选读取合成项目', configuration: { id: 'synthetic', revision: 1, name: '合成', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' } });
  const task = await projects.createTask(project.id, { name: '候选读取合成任务' });
  const controls = new AgentCandidateControls({ dataRoot, readTarget: async ref => { await reader.read(ref); } });
  const reader = createAgentCandidateReader({ projects, controls });
  return { root, projects, project, task, controls, reader };
}
function native(project: ProjectRecord, task: TaskRecord, title: string, options: { sessionId?: string; requestId?: string; padding?: number; outcome?: 'completed' | 'cancelled' | 'failed' | null } = {}) {
  const sessionId = options.sessionId ?? randomUUID(), requestId = options.requestId ?? randomUUID(), timestamp = '2026-11-03T08:00:00.000Z', toolCallId = 'candidate-call';
  const details: AgentCandidateDetails = { schemaVersion: 1, type: 'optracall.agent-candidate', claim: 'agent-generated-unconfirmed', origin: { projectId: project.id, taskId: task.id, sessionId, requestId, toolCallId }, createdAt: timestamp, content: { kind: 'knowledge', title, bodyMd: '合成正文独有关键词', aliases: ['合成别名'], scope: '合成范围', caution: null }, sourceRefs: [] };
  const lines: Record<string, unknown>[] = [
    { type: 'session', version: 3, id: sessionId, timestamp, cwd: path.join(project.rootPath, '020_clean') },
    { type: 'custom', id: 'started', parentId: null, timestamp, customType: 'optracall.run', data: { phase: 'started', requestId, sessionId, kind: 'prompt' } },
    { type: 'message', id: 'call', parentId: 'started', timestamp, message: { role: 'assistant', content: [{ type: 'toolCall', id: toolCallId, name: candidateToolName, arguments: { content: details.content, sourceRefs: [] } }] } },
    { type: 'message', id: 'result', parentId: 'call', timestamp, message: { role: 'toolResult', toolName: candidateToolName, toolCallId, details, content: [{ type: 'text', text: '已接受、待保存' }], isError: false, timestamp: Date.parse(timestamp) } },
  ];
  if (options.outcome !== null) lines.push({ type: 'custom', id: 'settled', parentId: 'result', timestamp, customType: 'optracall.run', data: { phase: 'settled', requestId, sessionId, outcome: options.outcome ?? 'completed' } });
  if (options.padding) lines.push({ type: 'custom', id: 'padding', parentId: lines.at(-1)!.id, timestamp, customType: 'synthetic.padding', data: { text: '.'.repeat(options.padding) } });
  return { sessionId, requestId, timestamp, details, lines, bytes: Buffer.from(lines.map(line => JSON.stringify(line)).join('\n') + '\n') };
}
async function save(task: TaskRecord, name: string, bytes: Buffer) { const file = path.join(task.sessionDirectory, name + '.jsonl'); await fs.writeFile(file, bytes); return file; }

test('reader processes at most 20 files per query and resumes explicitly, while rejecting changed or invalid cursors', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 21; i++) { const n = native(f.project, f.task, `候选${i}`); await save(f.task, String(i).padStart(2, '0') + '_' + n.sessionId, n.bytes); }
  const first = await f.reader.lookup({ pageSize: 100 });
  assert.equal(first.rows.length, 20); assert.equal(first.partial, true); assert.ok(first.nextCursor); assert.deepEqual(first.issues, []);
  const second = await f.reader.lookup({ pageSize: 100, cursor: first.nextCursor! });
  assert.equal(second.rows.length, 1); assert.equal(second.nextCursor, null); assert.equal(second.partial, false);
  assert.equal(new Set([...first.rows, ...second.rows].map(row => row.ref?.originSessionId)).size, 21);
  for (const pageSize of [0, 101, -1, 1.5]) await assert.rejects(f.reader.lookup({ pageSize }), { code: 'invalid_candidate_query', status: 400 });
  await assert.rejects(f.reader.lookup({ cursor: first.nextCursor!, query: 'different' }), { code: 'candidate_cursor_changed', status: 409 });
  await assert.rejects(f.reader.lookup({ cursor: 'not-a-cursor' }), { code: 'candidate_cursor_changed', status: 409 });
});

test('one native file uses default 50-row pages and allows an explicit 100-row maximum without losing occurrences', async t => {
  const f = await fixture(t), n = native(f.project, f.task, '分页模板', { outcome: null }), lines = n.lines.slice(0, 2);
  let parentId = 'started';
  for (let index = 0; index < 105; index++) {
    const details = structuredClone(n.details), toolCallId = `call-${index}`, callId = `assistant-${index}`, resultId = `result-${index}`;
    details.origin.toolCallId = toolCallId; details.content.title = `页内候选${index}`; details.createdAt = new Date(Date.parse(n.timestamp) + index).toISOString();
    lines.push({ type: 'message', id: callId, parentId, timestamp: n.timestamp, message: { role: 'assistant', content: [{ type: 'toolCall', id: toolCallId, name: candidateToolName, arguments: { content: details.content, sourceRefs: [] } }] } });
    lines.push({ type: 'message', id: resultId, parentId: callId, timestamp: n.timestamp, message: { role: 'toolResult', toolName: candidateToolName, toolCallId, details, content: [{ type: 'text', text: '已接受、待保存' }], isError: false, timestamp: Date.parse(n.timestamp) } });
    parentId = resultId;
  }
  await save(f.task, 'page_' + n.sessionId, Buffer.from(lines.map(line => JSON.stringify(line)).join('\n') + '\n'));
  const first = await f.reader.lookup(), second = await f.reader.lookup({ cursor: first.nextCursor! }), third = await f.reader.lookup({ cursor: second.nextCursor! });
  assert.deepEqual([first.rows.length, second.rows.length, third.rows.length], [50, 50, 5]); assert.equal(third.nextCursor, null);
  assert.equal(first.rows[0]?.details?.content.title, '页内候选104', 'verified generation time drives descending order');
  const keys = [...first.rows, ...second.rows, ...third.rows].map(row => row.ref?.entryId);
  assert.equal(new Set(keys).size, 105);
  const large = await f.reader.lookup({ pageSize: 100 }), tail = await f.reader.lookup({ pageSize: 100, cursor: large.nextCursor! });
  assert.equal(large.rows.length, 100); assert.equal(tail.rows.length, 5); assert.equal(tail.nextCursor, null);
});

test('reader enforces aggregate 50 MiB through a continuation and reports an oversized single file explicitly', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 2; i++) { const n = native(f.project, f.task, `大文件候选${i}`, { padding: 26 * 1024 * 1024 }); await save(f.task, `${i}_${n.sessionId}`, n.bytes); }
  const first = await f.reader.lookup();
  assert.equal(first.rows.length, 1); assert.ok(first.nextCursor); assert.equal(first.partial, true); assert.deepEqual(first.issues, []);
  const second = await f.reader.lookup({ cursor: first.nextCursor! });
  assert.equal(second.rows.length, 1); assert.equal(second.nextCursor, null);
  const oversized = path.join(f.task.sessionDirectory, 'z_oversized.jsonl');
  const handle = await fs.open(oversized, 'w'); try { await handle.truncate(nativeSnapshotLimit + 1); } finally { await handle.close(); }
  const withOversized = await f.reader.lookup({ cursor: first.nextCursor! }).catch(error => error);
  assert.equal(withOversized.code, 'candidate_cursor_changed', 'file inventory changes invalidate an old cursor');
  const page1 = await f.reader.lookup(), page2 = await f.reader.lookup({ cursor: page1.nextCursor! });
  assert.equal(page2.issues.length, 1); assert.equal(page2.issues[0]?.code, 'native_snapshot_too_large'); assert.equal(page2.partial, true);
  assert.equal((await fs.stat(oversized)).size, nativeSnapshotLimit + 1, 'oversized source remains intact');
});

test('invalid native files also consume the aggregate read budget instead of allowing repeated full-size reads', async t => {
  const f = await fixture(t);
  const invalid = Buffer.alloc(26 * 1024 * 1024, 0x78); invalid[invalid.length - 1] = 0x0a;
  await save(f.task, '0_invalid', invalid); await save(f.task, '1_invalid', invalid);
  const n = native(f.project, f.task, '后续有效候选'); await save(f.task, '2_valid_' + n.sessionId, n.bytes);
  const first = await f.reader.lookup();
  assert.equal(first.rows.length, 0, 'the second over-budget read and later files must wait for continuation');
  assert.equal(first.issues.length, 1, 'only the first 26 MiB file fits this query budget');
  assert.ok(first.nextCursor, 'corrupt bytes still require an explicit continuation for further files');
  const next = await f.reader.lookup({ cursor: first.nextCursor! });
  assert.equal(next.rows.length, 1); assert.equal(next.issues.length, 1); assert.equal(next.nextCursor, null);
});

test('all saved paths are found, fork copies keep one origin, and canonical branch labels are independent of parent running', async t => {
  const f = await fixture(t), n = native(f.project, f.task, '正在运行的候选', { outcome: null });
  // The original file saves a different leaf; its candidate is still discoverable.
  const originalLines = [...n.lines, { type: 'message', id: 'other-leaf', parentId: null, timestamp: n.timestamp, message: { role: 'user', content: '另一条已保存路径' } }];
  const original = await save(f.task, 'original_' + n.sessionId, Buffer.from(originalLines.map(line => JSON.stringify(line)).join('\n') + '\n'));
  const forkId = randomUUID(), forkLines = structuredClone(n.lines);
  forkLines[0] = { ...forkLines[0], id: forkId, parentSession: '/not-a-product-session/never-follow.jsonl' };
  const fork = await save(f.task, 'fork_' + forkId, Buffer.from(forkLines.map(line => JSON.stringify(line)).join('\n') + '\n'));
  await f.projects.setSession(f.project.id, f.task.id, fork);
  await f.projects.markRun(f.project.id, f.task.id, { id: n.requestId, status: 'running', startedAt: n.timestamp });
  const result = await f.reader.lookup();
  assert.equal(result.rows.length, 1); const row = result.rows[0]!;
  assert.equal(row.status, 'available'); assert.equal(row.parentState, 'running'); assert.equal(row.ref?.originSessionId, n.sessionId);
  assert.deepEqual(row.locations.map(location => location.savedPath).sort(), ['current', 'other']);
  assert.equal((await f.reader.lookup({ savedPath: 'current' })).rows.length, 1);
  assert.equal((await f.reader.lookup({ savedPath: 'other' })).rows.length, 1);
  assert.equal((await f.reader.lookup({ parentState: 'running' })).rows.length, 1);
  assert.equal((await f.reader.lookup({ parentState: 'completed' })).rows.length, 0);
  await f.projects.setSession(f.project.id, f.task.id, original);
  const moved = await f.reader.lookup();
  assert.equal(moved.rows[0]?.status, 'available'); assert.equal(moved.rows[0]?.parentState, 'running');
  assert.ok(moved.rows[0]?.locations.every(location => location.savedPath === 'other'), 'a persisted canonical file pointer does not make a detached candidate current');
});

test('owner, origin, tool call and run mismatches remain anomalous and never become discovered candidates', async t => {
  const f = await fixture(t), n = native(f.project, f.task, '身份测试');
  const file = await save(f.task, 'identity_' + n.sessionId, n.bytes);
  const variants: { reason: string; mutate: (lines: Record<string, unknown>[]) => void }[] = [
    { reason: 'candidate_owner_mismatch', mutate: lines => { const m = lines[3]!.message as { details: AgentCandidateDetails }; m.details.origin.projectId = randomUUID(); } },
    { reason: 'candidate_original_unknown', mutate: lines => { const m = lines[3]!.message as { details: AgentCandidateDetails }; m.details.origin.sessionId = randomUUID(); } },
    { reason: 'candidate_owner_mismatch', mutate: lines => { (lines[3]!.message as Record<string, unknown>).toolCallId = 'another-call'; } },
    { reason: 'candidate_run_mismatch', mutate: lines => { (lines[1]!.data as Record<string, unknown>).requestId = randomUUID(); } },
    { reason: 'candidate_tool_call_mismatch', mutate: lines => { const m = lines[2]!.message as { content: { arguments: { content: { title: string } } }[] }; m.content[0]!.arguments.content = { ...m.content[0]!.arguments.content, title: '改过的输入' }; } },
    { reason: 'candidate_tool_error', mutate: lines => { (lines[3]!.message as Record<string, unknown>).isError = true; } },
  ];
  for (const variant of variants) {
    const lines = structuredClone(n.lines); variant.mutate(lines);
    const bytes = Buffer.from(lines.map(line => JSON.stringify(line)).join('\n') + '\n'); await fs.writeFile(file, bytes);
    assert.equal((await f.reader.lookup()).rows.length, 0, variant.reason);
    const anomaly = await f.reader.lookup({ view: 'anomalies' });
    assert.equal(anomaly.rows.length, 1, variant.reason); assert.equal(anomaly.rows[0]?.reason, variant.reason);
    assert.equal(anomaly.rows[0]?.details, null); assert.equal(anomaly.rows[0]?.parentState, 'unknown');
    assert.deepEqual(await fs.readFile(file), bytes, 'lookup must preserve every malformed identity record');
  }
});

test('an existing exact human target becomes UNKNOWN after native hash change and cannot silently rebind', async t => {
  const f = await fixture(t), n = native(f.project, f.task, '旧准确候选');
  const file = await save(f.task, 'hash_' + n.sessionId, n.bytes), original = (await f.reader.lookup()).rows[0]!;
  assert.ok(original.ref);
  await f.controls.apply({ operationId: randomUUID(), target: original.ref, action: 'bookmark', note: null, expectedTargetRevision: 0 });
  const changed = structuredClone(n.lines), result = changed[3]!.message as { details: AgentCandidateDetails }, call = changed[2]!.message as { content: { arguments: { content: AgentCandidateDetails['content'] } }[] };
  result.details.content.bodyMd = '原始候选正文已被外部改动'; call.content[0]!.arguments.content = result.details.content;
  const changedBytes = Buffer.from(changed.map(line => JSON.stringify(line)).join('\n') + '\n'); await fs.writeFile(file, changedBytes);
  const found = await f.reader.lookup();
  assert.equal(found.rows.length, 1); assert.equal(found.rows[0]?.status, 'unknown'); assert.equal(found.rows[0]?.details, null);
  assert.deepEqual(found.rows[0]?.ref, original.ref); assert.equal(found.rows[0]?.control?.bookmarked, true);
  assert.equal((await f.reader.lookup({ view: 'anomalies' })).rows[0]?.reason, 'candidate_hash_inconsistent');
  const exactUnknown = await f.reader.read(original.ref); assert.equal(exactUnknown.status, 'unknown'); assert.equal(exactUnknown.details, null); assert.equal(exactUnknown.control?.bookmarked, true);
  assert.deepEqual(await fs.readFile(file), changedBytes);
});

test('fork and origin across file batches preserve current-path filtering and emit each original occurrence once', async t => {
  const f = await fixture(t), n = native(f.project, f.task, '跨批次原候选');
  const fork = structuredClone(n.lines); fork[0] = { ...fork[0], id: randomUUID() };
  const currentFile = await save(f.task, '00-current-fork', Buffer.from(fork.map(l => JSON.stringify(l)).join('\n') + '\n'));
  for (let i = 1; i < 20; i++) await save(f.task, String(i).padStart(2, '0') + '-empty', Buffer.from(JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: n.timestamp, cwd: f.project.rootPath }) + '\n'));
  await save(f.task, '20-origin-' + n.sessionId, n.bytes);
  await f.projects.setSession(f.project.id, f.task.id, currentFile);
  for (const savedPath of ['all', 'current', 'other'] as const) {
    let cursor: string | undefined; const rows = [];
    do { const page = await f.reader.lookup({ savedPath, cursor }); rows.push(...page.rows); cursor = page.nextCursor ?? undefined; } while (cursor);
    assert.equal(rows.length, 1); assert.equal(rows[0]?.status, 'available');
    assert.deepEqual(new Set(rows[0]?.locations.map(l => l.savedPath)), new Set(['current', 'other']));
  }
  let cursor: string | undefined; const anomalies = [];
  do { const page = await f.reader.lookup({ view: 'anomalies', cursor }); anomalies.push(...page.rows); cursor = page.nextCursor ?? undefined; } while (cursor);
  assert.deepEqual(anomalies, []);
});

test('a conflicting fork body cannot leave an apparently available original or admit first human bookmark', async t => {
  const f = await fixture(t), n = native(f.project, f.task, '原准确声明');
  await save(f.task, 'origin_' + n.sessionId, n.bytes);
  const fork = structuredClone(n.lines); fork[0] = { ...fork[0], id: randomUUID() };
  const message = fork[3].message as { details: AgentCandidateDetails }; message.details.content.bodyMd = '被改变的副本正文';
  await save(f.task, 'fork', Buffer.from(fork.map(l => JSON.stringify(l)).join('\n') + '\n'));
  const page = await f.reader.lookup(), row = page.rows[0];
  assert.equal(row?.status, 'unknown'); assert.equal(row?.details, null); assert.deepEqual(row?.locations, []);
  assert.equal(row?.reason, 'candidate_copy_changed');
});

test('a file growing between discovery stat and snapshot guard cannot evade the aggregate byte budget', async t => {
  const f = await fixture(t), n = native(f.project, f.task, '稳定第二文件', { padding: 26 * 1024 * 1024 });
  const first = await save(f.task, '0-growing', Buffer.from(JSON.stringify({ type: 'session', version: 3, id: 'growing', timestamp: n.timestamp, cwd: f.project.rootPath }) + '\n'));
  await save(f.task, '1-stable_' + n.sessionId, n.bytes);
  const original = fs.lstat.bind(fs); let hits = 0;
  // External filesystem boundary: deterministically append after the reader's outer stat.
  t.mock.method(fs, 'lstat', async (file: Parameters<typeof fs.lstat>[0]) => {
    const result = await original(file);
    if (file === first && ++hits === 2) await fs.writeFile(first, native(f.project, f.task, '竞态大文件', { padding: 26 * 1024 * 1024 }).bytes);
    return result;
  });
  const result = await f.reader.lookup();
  assert.equal(result.partial, true); assert.ok(result.issues.some(issue => issue.code === 'native_snapshot_too_large'));
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0]?.details?.content.title, '稳定第二文件');
});

test('a saved canonical file missing on first read is file-level UNKNOWN without guessed candidate identities', async t => {
  const f = await fixture(t), n = native(f.project, f.task, '首次不可读原件');
  const file = await save(f.task, 'saved_' + n.sessionId, n.bytes);
  await f.projects.setSession(f.project.id, f.task.id, file); await fs.rename(file, file + '.unread');
  const result = await f.reader.lookup();
  assert.deepEqual(result.rows, []); assert.equal(result.partial, true);
  assert.ok(result.issues.some(issue => issue.code === 'native_session_file_missing'));
  assert.deepEqual(await fs.readFile(file + '.unread'), n.bytes);
});
