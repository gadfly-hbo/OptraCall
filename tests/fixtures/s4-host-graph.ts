import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createHost } from '../../src/host/server.ts';
import type { SemanticGraphBinding } from '../../src/host/semantic-graph-service.ts';
import { startToolProvider } from './tool-provider.ts';
import { readJson } from './joint-context.ts';

export async function startS4GraphHost(options: { fixtureRoot: string; python: string; managed?: boolean; graph?: boolean }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-s4-host-')), dataRoot = path.join(root, 'host'), projectsRoot = path.join(root, 'projects');
  await cp(path.join(options.fixtureRoot, 'asset-root'), dataRoot, { recursive: true });
  await cp(path.join(options.fixtureRoot, 'projects-root'), projectsRoot, { recursive: true });
  const build = JSON.parse(await readFile(path.join(options.fixtureRoot, 'evidence/scene-v2-corrected-build.json'), 'utf8'));
  const binding: SemanticGraphBinding = { runRoot: options.fixtureRoot, snapshotId: build.snapshotId, python: options.python, codeRoot: process.cwd() };
  const provider = await startToolProvider(), bindings: { projectId: string; taskId: string }[] = [];
  const hostOptions = { cwd: process.cwd(), uiPorts: [4183], transportVersion: '8.12.2', dataRoot, projectsRoot,
    ...(options.graph === false ? {} : { semanticGraph: { bindingFor(projectId: string, taskId: string) { bindings.push({ projectId, taskId }); return projectId === build.refs.input.projectId ? binding : undefined; } } }) };
  let host = createHost(hostOptions); await host.ready;
  await new Promise<void>(resolve => host.server.listen(0, '127.0.0.1', resolve));
  const address = host.server.address(); assert.ok(address && typeof address !== 'string');
  let baseUrl = `http://127.0.0.1:${address.port}`;
  const headers = { 'content-type': 'application/json', 'x-optracall-client': '1', origin: 'http://127.0.0.1:4183' };
  const request = (route: string, method = 'GET', body?: unknown) => fetch(baseUrl + route, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const close = async () => {
    const settled = await Promise.allSettled([host.close(), provider.close()]);
    await writeFile(path.join(root, 'host-receipt.json'), JSON.stringify({ scope: 'S4_SYNTHETIC_HTTP_SDK_PYTHON_NATIVE_STORES', managed: options.managed === true, bindingSnapshot: binding.snapshotId, bindings, requests: provider.requests, providerErrors: provider.errors, shutdown: settled.map(result => result.status) }, null, 2));
    for (const result of settled) if (result.status === 'rejected') throw result.reason;
  };
  try {
    const { configuration } = await readJson(await request('/api/configuration', 'PUT', { name: 'S4 local synthetic Host integration', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-s4-host', apiKey: 'synthetic-s4-host-only' }));
    const projectId = build.refs.input.projectId as string;
    const { task } = await readJson(await request(`/api/projects/${projectId}/tasks`, 'POST', { name: options.managed ? 'S4 managed ordinary HTTP task' : 'S4 unmanaged ordinary HTTP task', configurationId: configuration.id }), 201);
    const taskRoute = `/api/projects/${projectId}/tasks/${task.id}`, automaticRoute = taskRoute + '/automatic-verification';
    await readJson(await request(`/api/metric-factory/projects/${projectId}/enable`, 'POST', { packageId: build.refs.metrics[0].packageId, version: build.refs.metrics[0].version }));
    const send = async (text: string) => { const requestId = randomUUID(); await readJson(await request(taskRoute + '/messages', 'POST', { text, requestId }), 202); return requestId; };
    const readTask = () => request(taskRoute).then(readJson);
    const settled = async (requestId: string) => {
      const deadline = Date.now() + 60_000;
      for (;;) { const state = await readTask(); if (state.task.lastRun?.id === requestId && state.task.lastRun.status !== 'running' && state.snapshot.status === 'idle') return state;
        assert.ok(Date.now() < deadline, `S4 task did not settle: ${JSON.stringify(state.task.lastRun)}`); await new Promise(resolve => setTimeout(resolve, 20)); }
    };
    const restart = async () => {
      await host.close();
      host = createHost(hostOptions); await host.ready; await new Promise<void>(resolve => host.server.listen(0, '127.0.0.1', resolve));
      const port = host.server.address(); assert.ok(port && typeof port !== 'string'); baseUrl = `http://127.0.0.1:${port.port}`;
    };
    return { root, dataRoot, projectsRoot, provider, host, request, close, build, binding, bindings, projectId, task, taskRoute, automaticRoute, send, readTask, settled, restart };
  } catch (error) { await close(); throw error; }
}
