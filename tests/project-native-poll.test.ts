import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { syntheticNativeHistory } from './fixtures/synthetic-native-history.ts';
import { createHost } from '../src/host/server.ts';
import { ProjectStore } from '../src/host/project-store.ts';

test('ordinary Task GET re-reads a racing native append and refuses a corrupt original without retrying it', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-poll-'));
  const dataRoot = path.join(root, 'private'), projectsRoot = path.join(root, 'projects');
  const projects = new ProjectStore({ dataRoot, projectsRoot }); await projects.init();
  const project = await projects.create({ name: '轮询测试', configuration: { id: 'synthetic', revision: 1, name: '合成', model: 'synthetic', provider: 'synthetic', baseUrl: 'https://example.invalid' } });
  const task = await projects.createTask(project.id, { name: '原任务' });
  const ledger = syntheticNativeHistory(task.sessionDirectory, path.join(project.rootPath, '020_clean'));
  ledger.message('user','合成问题'); ledger.message('assistant','合成回复');
  const native = ledger.file;
  await projects.setSession(project.id, task.id, native); await projects.close();
  const host = createHost({ cwd:process.cwd(), dataRoot, projectsRoot, transportVersion:'isolated-native-poll', uiPorts:[4183] });
  await host.ready; await new Promise<void>(resolve => host.server.listen(0, '127.0.0.1', resolve)); t.after(async () => { await host.close(); await fs.rm(root, { recursive: true, force: true }); });
  const address = host.server.address(); assert.ok(address && typeof address !== 'string');
  const get = () => fetch('http://127.0.0.1:' + address.port + '/api/projects/' + project.id + '/tasks/' + task.id, { headers: { origin:'http://127.0.0.1:4183', 'x-optracall-client':'1' } });
  assert.equal((await get()).status, 200);
  let remainingAppends = 1, reads = 0;
  const open = fs.open.bind(fs);
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    if (String(args[0]) === native) {
      reads++;
      if (remainingAppends > 0) { remainingAppends--; ledger.append({type:'custom',customType:'synthetic.poll-append',data:{observedBy:'test'}}); }
    }
    return open(...args);
  });
  const value = await get(); assert.equal(value.status, 200, await value.clone().text());
  assert.equal((await value.json()).task.id, task.id); assert.ok(reads >= 2);
  reads = 0; remainingAppends = 10;
  const changing = await get(); assert.equal(changing.status, 409, await changing.clone().text());
  assert.equal((await changing.json()).code, 'native_snapshot_changed'); assert.equal(reads, 5);
  remainingAppends = 0; reads = 0;
  await fs.appendFile(native, 'not-valid-json\n');
  const corrupt = await get(); assert.equal(corrupt.status, 409, await corrupt.clone().text());
  assert.equal((await corrupt.json()).code, 'session_history_unavailable'); assert.equal(reads, 1);
});
