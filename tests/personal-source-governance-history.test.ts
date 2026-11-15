import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectStore } from '../src/host/project-store.ts';
import { readPersonalContextHistory } from '../src/host/personal-context-history.ts';
import type { PersonalContextDeliveryItem, PersonalSourceGovernance } from '../src/agent/personal-context.ts';

test('R3-05: history accepts bounded new receipts and legacy absence, rejects malformed sidecars, and never backfills today into recorded delivery', async t => {
  const base = path.resolve('.local/memory-source-governance/history'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'root-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') });
  await projects.init(); t.after(() => projects.close());
  const project = await projects.create({ name: '历史合成', configuration: { id: 'synthetic', revision: 1, name: 'synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' } });
  const task = await projects.createTask(project.id, { name: '历史合成' }), sessionId = randomUUID();
  const timestamp = '2026-11-15T08:00:00.000Z', file = path.join(task.sessionDirectory, 'history.jsonl');
  const summary: PersonalSourceGovernance = { totalReferences: 1, inspectedReferences: 1, uncheckedReferences: 0, sourceBodyAvailability: 'not-checked', items: [{ sourceIndex: 0, state: 'known', reason: null, excluded: false, targetRevision: 1, latestCorrectionOperationId: randomUUID(), correction: 'RECORDED_OLD_NOTE', correctionTruncated: false }] };
  const item: PersonalContextDeliveryItem = { target: { type: 'retained', storeId: 's', materialId: 'm', decisionId: 'd', revisionId: 'r', expectedBodySha256: 'a'.repeat(64) }, part: 'content', extent: 'full', range: { start: 0, end: 1 }, title: '旧经验', scope: null, effectiveTime: null, caution: null, governance: { archived: false, enterpriseEnabled: false, sourceProjectArchived: null, targetRevision: null, latestCorrectionOperationId: null }, limitations: [] };
  const variations = [undefined, summary, { ...summary, items: Array.from({ length: 9 }, () => summary.items[0]) }, { ...summary, items: [{ ...summary.items[0], excluded: true }] }];
  const lines: unknown[] = [{ type: 'session', version: 3, id: sessionId, timestamp, cwd: path.join(project.rootPath, '020_clean') }];
  let parentId: string | null = null;
  for (const [index, sourceGovernance] of variations.entries()) {
    const call = `call-${index}`, result = `result-${index}`;
    lines.push({ type: 'message', id: call, parentId, timestamp, message: { role: 'assistant', content: [{ type: 'toolCall', id: call, name: 'read_personal_context', arguments: { target: item.target } }] } });
    lines.push({ type: 'message', id: result, parentId: call, timestamp, message: { role: 'toolResult', toolName: 'read_personal_context', toolCallId: call, content: [{ type: 'text', text: index === 0 ? 'LEGACY_BODY_ONLY' : 'RECORDED_OLD_NOTE' }], isError: false, timestamp: Date.parse(timestamp), details: { schemaVersion: 1, type: 'optracall.personal-context-delivery', action: 'read', items: [{ ...item, sourceGovernance }], partial: false, continuation: null, issues: [] } } });
    parentId = result;
  }
  const bytes = Buffer.from(lines.map(line => JSON.stringify(line)).join('\n') + '\n'); await fs.writeFile(file, bytes); const before = await fs.stat(file);
  const history = await readPersonalContextHistory(project, task, async target => ({ target, state: 'available', governance: { ...item.governance, archived: true } }));
  assert.deepEqual(history.entries.map(entry => entry.entryId), ['result-0', 'result-1']);
  assert.equal(history.entries[0]?.details?.items[0]?.sourceGovernance, undefined);
  assert.equal(history.entries[1]?.details?.items[0]?.sourceGovernance?.items[0]?.excluded, false);
  assert.equal(history.entries[1]?.details?.items[0]?.governance.archived, false);
  assert.equal(history.entries[1]?.current[0]?.governance?.archived, true);
  assert.equal(history.issues.length, 2); assert.equal(history.partial, true);
  assert.deepEqual(await fs.readFile(file), bytes); assert.equal((await fs.stat(file)).mtimeMs, before.mtimeMs);
});
