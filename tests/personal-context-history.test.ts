import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectStore, type ProjectRecord, type TaskRecord } from '../src/host/project-store.ts';
import { savedTaskHistory, taskContextReceipts, priorTaskRequest } from '../src/host/project-history.ts';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const base = path.resolve('.local/fourbase-modules/m4/implementation/history/roots');
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'native-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') });
  await projects.init(); t.after(() => projects.close());
  const project = await projects.create({ name: 'M4只读合成项目', configuration: { id: 'synthetic', revision: 1, name: '合成', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' } });
  const task = await projects.createTask(project.id, { name: 'M4历史任务' });
  return { projects, project, task };
}

test('RU10 task history refuses an old native version without migrating any original bytes or mtime', async t => {
  const { project, task } = await fixture(t), file = path.join(task.sessionDirectory, 'old.jsonl');
  const timestamp = '2026-11-03T08:00:00.000Z', sessionId = randomUUID();
  const bytes = Buffer.from([
    { type: 'session', version: 2, id: sessionId, timestamp, cwd: path.join(project.rootPath, '020_clean') },
    { type: 'message', id: 'answer', parentId: null, timestamp, message: { role: 'assistant', content: [{ type: 'text', text: '旧材料保持原状' }], timestamp: Date.parse(timestamp) } },
  ].map(v => JSON.stringify(v)).join('\n') + '\n');
  await fs.writeFile(file, bytes); const before = await fs.stat(file);
  await assert.rejects(async () => savedTaskHistory(project, { ...task, sessionFile: file }, 'synthetic'), /session_history_unavailable/);
  assert.deepEqual(await fs.readFile(file), bytes);
  assert.equal((await fs.stat(file)).mtimeMs, before.mtimeMs);
});

for (const [name, read] of [
  ['provided receipts', (project: ProjectRecord, task: TaskRecord) => taskContextReceipts(project, task)],
  ['request deduplication', (project: ProjectRecord, task: TaskRecord) => priorTaskRequest(project, task, 'm4-old-request')],
] as const) {
  test(`RU10 ${name} also refuses old native without changing source or inventing accepted delivery`, async t => {
    const { project, task } = await fixture(t), file = path.join(task.sessionDirectory, 'old.jsonl');
    const timestamp = '2026-11-03T08:00:00.000Z';
    const bytes = Buffer.from([
      { type: 'session', version: 2, id: randomUUID(), timestamp, cwd: path.join(project.rootPath, '020_clean') },
      { type: 'custom', id: 'started', parentId: null, timestamp, customType: 'optracall.run', data: { phase: 'started', requestId: 'm4-old-request', providedContext: { version: 1 } } },
    ].map(v => JSON.stringify(v)).join('\n') + '\n');
    await fs.writeFile(file, bytes); const before = await fs.stat(file);
    await assert.rejects(async () => read(project, { ...task, sessionFile: file }), /session_history_unavailable/);
    assert.deepEqual(await fs.readFile(file), bytes);
    assert.equal((await fs.stat(file)).mtimeMs, before.mtimeMs);
  });
}

import { createHash } from 'node:crypto';
import { readPersonalContextHistory } from '../src/host/personal-context-history.ts';
import type { PersonalContextDeliveryItem } from '../src/agent/personal-context.ts';

test('RU09 history never borrows a previous personal receipt for a later run with identical user text', async t => {
  const { project, task } = await fixture(t), file = path.join(task.sessionDirectory, 'repeat.jsonl');
  const timestamp = '2026-11-03T09:00:00.000Z', sessionId = randomUUID(), text = '完全相同的用户文本';
  const item: PersonalContextDeliveryItem = { target: { type: 'retained', storeId: 's', materialId: 'm', decisionId: 'd', revisionId: 'r', expectedBodySha256: 'a'.repeat(64) }, part: 'content', extent: 'full', range: { start: 0, end: 1 }, title: '旧参考', scope: null, effectiveTime: null, caution: null, governance: { archived: false, enterpriseEnabled: false, sourceProjectArchived: null, targetRevision: null, latestCorrectionOperationId: null }, limitations: [] };
  const providedContext = { version: 1, requestTextSha256: createHash('sha256').update(text).digest('hex'), personal: { schemaVersion: 1, items: [item] } };
  const lines = [
    { type: 'session', version: 3, id: sessionId, timestamp, cwd: path.join(project.rootPath, '020_clean') },
    { type: 'custom', id: 'start-a', parentId: null, timestamp, customType: 'optracall.run', data: { phase: 'started', sessionId, requestId: 'a', providedContext } },
    { type: 'message', id: 'user-a', parentId: 'start-a', timestamp, message: { role: 'user', content: text } },
    { type: 'custom', id: 'end-a', parentId: 'user-a', timestamp, customType: 'optracall.run', data: { phase: 'settled', sessionId, requestId: 'a', outcome: 'completed' } },
    { type: 'custom', id: 'start-b', parentId: 'end-a', timestamp, customType: 'optracall.run', data: { phase: 'started', sessionId, requestId: 'b', providedContext: { ...providedContext, personal: undefined } } },
    { type: 'message', id: 'user-b', parentId: 'start-b', timestamp, message: { role: 'user', content: text } },
  ];
  await fs.writeFile(file, lines.map(v => JSON.stringify(v)).join('\n') + '\n');
  const result = await readPersonalContextHistory(project, task, async target => ({ target, state: 'available' }));
  assert.deepEqual(result.entries.map(entry => entry.entryId), ['user-a']);
});
