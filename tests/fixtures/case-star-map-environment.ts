import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestHost } from './host-process.ts';
import { startToolProvider } from './tool-provider.ts';
import { sessionEvents } from './session-events.ts';
import { readJson } from './joint-context.ts';
import { runtimeEnvironment, workspaceRoot } from '../../scripts/runtime-process.ts';

// Opt-in isolated engineering fixture. No real Provider, credentials or business root.
const evidenceRoot = path.join(workspaceRoot, '.local/case-star-map-implementation/ui');
const evidence = path.join(evidenceRoot, randomUUID());
await mkdir(evidence, { recursive: true });
const provider = await startToolProvider();
const host = await startTestHost({ uiPort: 4191, dataRoot: path.join(evidence, 'host'), projectsRoot: path.join(evidence, 'projects') });
let vite: ReturnType<typeof spawn> | undefined, closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  vite?.kill('SIGTERM');
  await writeFile(path.join(evidence, 'provider-observations.json'), JSON.stringify({ requestCount: provider.requests.length, errors: provider.errors }, null, 2));
  await host.close();
  await provider.close();
};
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { void close().then(() => process.exit(0)); });

try {
  await readJson(await host.request('/api/configuration', 'PUT', { name: 'Case-Star-Map 隔离合成模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-case-star-map', apiKey: 'synthetic-case-star-map-only' }));
  await readJson(await host.request('/api/cases/storage/initialize', 'POST', {}));
  const createProject = async (name: string) => (await readJson(await host.request('/api/projects', 'POST', { name }), 201)).project;
  const createTask = async (projectId: string, name: string) => (await readJson(await host.request(`/api/projects/${projectId}/tasks`, 'POST', { name }), 201)).task;
  const createCase = async (title: string) => (await readJson(await host.request('/api/cases', 'POST', { operationId: randomUUID(), title }), 201)).case;
  const p1 = await createProject('合成 · 门店经营诊断'), p2 = await createProject('合成 · 试行观察与复盘'), p3 = await createProject('合成 · 独立资料项目');
  const t1 = await createTask(p1.id, '可比门店销售结构'), t2 = await createTask(p1.id, '库存影响核查');
  const freshTask = await createTask(p2.id, '试行观察记录');
  const a = await createCase('合成 · 春季门店销售回落'), b = await createCase('合成 · 周末陈列试行'), c = await createCase('合成 · 观察结果复盘'), d = await createCase('合成 · 尚未关联项目');
  for (const [record, project] of [[a, p1], [b, p1], [b, p2], [c, p2]]) {
    const current = (await readJson(await host.request(`/api/cases/${record.id}`))).case;
    await readJson(await host.request(`/api/cases/${record.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: current.revision, projectId: project.id }));
  }
  const seedDecision = async (caseId: string, taskId: string, input: Record<string, unknown>) => {
    const record = (await readJson(await host.request(`/api/cases/${caseId}`))).case;
    provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: '合成工程种子已保存；不是业务验证。' } : { calls: [{ name: 'save_case_decision_draft', arguments: input }] });
    const events = await sessionEvents(host, p1.id, taskId);
    try {
      await readJson(await host.request(`/api/projects/${p1.id}/tasks/${taskId}/messages`, 'POST', { requestId: randomUUID(), text: '请按本次合成材料保存预置判断，供工程界面检查。', caseContext: { caseId, caseRevision: record.revision, projectWorkRevision: 0, selectedReferenceIds: [] } }), 202);
      const settled = await events.terminal;
      assert.equal(settled.type, 'run.settled');
      if (settled.type === 'run.settled') assert.equal(settled.outcome, 'completed');
    } finally { await events.close(); }
    const decisions = await readJson(await host.request(`/api/cases/${caseId}/decisions`));
    assert.equal(decisions.items.length, 1);
    return decisions.items[0];
  };
  const source = await seedDecision(a.id, t1.id, { kind: 'hypothesis', expectedRevision: 0, payload: { title: '可比条件仍待核实', statement: '先区分客流、转化和库存条件；当前不证明陈列导致销售变化。' } });
  const target = await seedDecision(b.id, t2.id, { kind: 'strategy', expectedRevision: 0, payload: { title: '限定范围的小规模观察', proposal: '在相近客流与库存条件下观察陈列试行，保留执行和效果未知。' } });
  await readJson(await host.request(`/api/projects/${p1.id}/tasks/${t2.id}/draft`, 'PATCH', { text: '这份未发送草稿应在图谱导航前后保留。' }));
  const seed = { projects: [p1, p2, p3], tasks: [t1, t2, freshTask], cases: [a, b, c, d], source, target, providerCallsBeforeBrowsing: provider.requests.length };
  await writeFile(path.join(evidence, 'seed.json'), JSON.stringify(seed, null, 2));
  await writeFile(path.join(evidenceRoot, 'latest.json'), JSON.stringify({ evidence, hostPort: host.port, runnerPid: process.pid }, null, 2));
  await writeFile(path.join(evidence, 'provider-observations.json'), JSON.stringify({ requestCount: provider.requests.length, errors: provider.errors }, null, 2));
  provider.setResponder(() => ({ text: '合成固定回复；没有真实模型请求。' }));
  vite = spawn(process.execPath, [fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url)), '--host', '127.0.0.1', '--port', '4191', '--strictPort'], { cwd: workspaceRoot, env: { ...runtimeEnvironment(), OPTRACALL_HOST_PORT: String(host.port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', ready = false;
  vite.stdout?.on('data', chunk => {
    output += chunk.toString();
    if (!ready && output.includes('http://127.0.0.1:4191/')) {
      ready = true;
      process.stdout.write(`${JSON.stringify({ kind: 'case-map-qa-ready', uiUrl: 'http://127.0.0.1:4191/', hostPort: host.port, runnerPid: process.pid, evidence, providerCallsBeforeBrowsing: provider.requests.length })}\n`);
    }
  });
  vite.stderr?.on('data', chunk => process.stderr.write(chunk));
  vite.on('exit', () => { if (!closing) void close(); });
  vite.on('error', error => { process.stderr.write(`${error.message}\n`); void close(); });
  // Persist protocol counters without exposing a new product endpoint.
  const observations = setInterval(() => { if (!closing) void writeFile(path.join(evidence, 'provider-observations.json'), JSON.stringify({ requestCount: provider.requests.length, errors: provider.errors }, null, 2)); }, 1000);
  observations.unref();
} catch (error) {
  await close();
  throw error;
}
