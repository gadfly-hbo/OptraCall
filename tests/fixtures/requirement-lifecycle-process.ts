import type { TestContext } from 'node:test';
import { mkdtemp, mkdir, writeFile, readdir, readFile, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequirementSessions } from '../../src/host/requirement-sessions.ts';
import type { RuntimeModelConfiguration } from '../../src/host/config-store.ts';

type Child = { pid: number; cwd: string };

// A real child-process/IPC boundary with a controlled ready handshake. The
// lifecycle under test remains the real manager and ProjectAgent; this fixture
// does not represent SDK/model quality or replace the real-Host checks.
const entry = String.raw`
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const cwd = process.cwd(), pid = process.pid;
const sessionId = randomUUID();
const marker = name => path.join(cwd, name + '-' + pid);
fs.writeFileSync(marker('spawned'), JSON.stringify({ pid, cwd }));
const wait = name => new Promise(resolve => {
  if (fs.existsSync(marker(name))) return resolve();
  const timer = setInterval(() => { if (fs.existsSync(marker(name))) { clearInterval(timer); resolve(); } }, 5);
});
const reply = (id, result) => process.send?.({ kind: 'reply', id, result });
let sessionFile;
process.on('message', async request => {
  if (request.kind !== 'request') return;
  if (request.method === 'close') {
    fs.writeFileSync(marker('closing'), '1');
    if (fs.existsSync(path.join(cwd, 'hold-close'))) await wait('release-close');
    process.send?.({ kind: 'reply', id: request.id, result: null }, () => process.exit(0));
  } else if (request.method === 'open') {
    sessionFile = path.join(request.input.sessionDirectory, 'controlled.jsonl');
    fs.writeFileSync(sessionFile, JSON.stringify({ type: 'session', version: 3, id: sessionId, timestamp: new Date().toISOString(), cwd }) + '\n');
    reply(request.id, { messages: [], tools: [], status: 'idle', sessionFile });
  } else if (request.method === 'prompt') {
    fs.writeFileSync(marker('prompted'), request.input.text);
    fs.appendFileSync(sessionFile, JSON.stringify({ type: 'custom', id: randomUUID().slice(0, 8), parentId: null, timestamp: new Date().toISOString(), customType: 'optracall.run', data: { phase: 'started', requestId: request.input.requestId, sessionId, kind: 'prompt' } }) + '\n');
    // The shared port waits for durable native acceptance as well as completion.
    // Provide a real synthetic file for ProjectAgent's path check and fsync.
    process.send?.({ kind: 'event', event: { type: 'run.accepted', requestId: request.input.requestId, sessionFile } });
    reply(request.id, { outcome: 'completed', text: 'controlled subprocess response' });
  } else if (request.method === 'stop') reply(request.id, null);
});
await wait('release-ready');
process.send?.({ kind: 'ready' });
`;

export async function controlledRequirementProcess(t: TestContext) {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'optracall-requirement-lifecycle-'));
  const codeRoot = path.join(scratch, 'runtime');
  await mkdir(path.join(codeRoot, 'scripts'), { recursive: true });
  await writeFile(path.join(codeRoot, 'scripts/project-entry.mjs'), entry);
  let configuration: Readonly<RuntimeModelConfiguration> | undefined = { id: 'profile-a', revision: 1, name: 'Synthetic A', provider: 'provider-a', api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', model: 'model-a', apiKey: 'synthetic-process-only' };
  const configurations = new Map([[configuration.id, configuration]]);
  const children: Child[] = [];
  let disposed = false;
  const manager = createRequirementSessions({
    codeRoot, resourceRoot: path.join(scratch, 'resources'), managementPorts: () => [],
    sessionDirectory: id => path.join(scratch, id, 'sessions'),
    workspaceFor: id => ({ cwd: path.join(scratch, id, 'workspace'), systemPrompt: [], defaultTools: [] }),
    configurationSnapshot: (id, revision) => { const value = id ? configurations.get(id) : configuration; return value && (revision === undefined || value.revision === revision) ? value : undefined; },
    publish: () => {}, mutate: async operation => operation(), isClosing: () => false,
  });
  const exists = async (file: string) => { try { await access(file); return true; } catch { return false; } };
  const until = async <T,>(read: () => Promise<T | undefined>, message: string): Promise<T> => {
    const deadline = Date.now() + 5000;
    while (!disposed && Date.now() < deadline) { const result = await read(); if (result !== undefined) return result; await new Promise(resolve => setTimeout(resolve, 5)); }
    throw new Error(message);
  };
  const spawned = async (id: string): Promise<Child> => until(async () => {
    const cwd = path.join(scratch, id, 'workspace');
    const names = await readdir(cwd).catch(() => []);
    for (const name of names.filter(value => value.startsWith('spawned-'))) {
      const child = JSON.parse(await readFile(path.join(cwd, name), 'utf8')) as Child;
      if (children.some(existing => existing.pid === child.pid)) continue;
      children.push(child); return child;
    }
    return undefined;
  }, 'controlled requirement process did not spawn');
  t.after(async () => {
    disposed = true;
    for (const child of children) await writeFile(path.join(child.cwd, `release-close-${child.pid}`), '1');
    await manager.closeAll();
    for (const child of children) { try { process.kill(child.pid, 'SIGTERM'); } catch {} }
    await rm(scratch, { recursive: true, force: true });
  });
  return {
    manager, spawned,
    select: (provider: string) => { configuration = { ...configuration!, id: provider, provider, model: provider, revision: (configuration?.revision ?? 0) + 1 }; configurations.set(configuration.id, configuration); },
    clear: () => { configuration = undefined; configurations.clear(); },
    release: (child: Child) => writeFile(path.join(child.cwd, `release-ready-${child.pid}`), '1'),
    prompted: (child: Child) => exists(path.join(child.cwd, `prompted-${child.pid}`)),
    holdClose: (child: Child) => writeFile(path.join(child.cwd, 'hold-close'), '1'),
    releaseClose: (child: Child) => writeFile(path.join(child.cwd, `release-close-${child.pid}`), '1'),
    waitClosing: (child: Child) => until(async () => await exists(path.join(child.cwd, `closing-${child.pid}`)) ? true : undefined, 'controlled requirement process was not closed'),
  };
}
