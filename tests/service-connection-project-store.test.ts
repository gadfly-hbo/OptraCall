import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectStore } from '../src/host/project-store.ts';
import type { TaskServiceBinding } from '../src/host/service-connection-types.ts';

const binding: TaskServiceBinding = { service: 'github', connectionId: 'connection-one', accountId: '42', accountLabel: 'fixture', revision: 1, scopes: ['read'], repositories: ['owner/repo'], tools: [] };

test('GG05 task metadata preserves explicit connection snapshots across unrelated writes and restart without inheritance', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-service-project-'));
  const options = { dataRoot: path.join(root, 'private'), projectsRoot: path.join(root, 'projects') };
  let store = new ProjectStore(options);
  t.after(async () => { await store.close(); await fs.rm(root, { recursive: true, force: true }); });
  await store.init();
  const project = await store.create({ name: 'connection owner', configuration: { id: 'synthetic', name: 'synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1', revision: 1 } });
  const a = await store.createTask(project.id, { name: 'A' });
  const file = path.join(options.dataRoot, 'projects', project.id, 'project.json');
  const metadata = JSON.parse(await fs.readFile(file, 'utf8'));
  metadata.tasks[0].serviceConnections = { github: binding };
  await fs.writeFile(file, JSON.stringify(metadata));
  assert.deepEqual((await store.getTask(project.id, a.id) as unknown as { serviceConnections: unknown }).serviceConnections, { github: binding });
  await store.saveDraft(project.id, a.id, 'original draft');
  const b = await store.createTask(project.id, { name: 'B' });
  assert.equal((b as unknown as { serviceConnections?: unknown }).serviceConnections, undefined);
  await store.close(); store = new ProjectStore(options); await store.init();
  const restored = await store.getTask(project.id, a.id) as unknown as { serviceConnections: unknown; draft: string };
  assert.deepEqual(restored.serviceConnections, { github: binding }); assert.equal(restored.draft, 'original draft');
  const corrupt = JSON.parse(await fs.readFile(file, 'utf8'));
  corrupt.tasks[0].serviceConnections.github.accountId = '';
  const bytes = JSON.stringify(corrupt); await fs.writeFile(file, bytes);
  await assert.rejects(store.getTask(project.id, a.id));
  assert.equal(await fs.readFile(file, 'utf8'), bytes, 'corrupt policy remains preserved and unavailable');
});
