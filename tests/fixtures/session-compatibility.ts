import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { startTestHost } from './host-process.ts';
import type { startSyntheticProvider } from './synthetic-provider.ts';
import { prepareJointContext, readJson } from './joint-context.ts';
import { sessionEvents } from './session-events.ts';

type Host = Awaited<ReturnType<typeof startTestHost>>;
type Provider = Awaited<ReturnType<typeof startSyntheticProvider>>;
type Files = Record<string, string>;

/** Snapshot files only in the caller's isolated fixture roots. SQLite is checked
 * logically after Host shutdown, never by hashing a live database or sidecars. */
export async function compatibilityFiles(roots: readonly string[]): Promise<Files> {
  const files: Files = {};
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && !entry.name.startsWith('decision-cases.sqlite3')) files[file] = (await readFile(file)).toString('base64');
      else assert.equal(entry.isSymbolicLink(), false, 'synthetic fixture cannot introduce linked user files');
    }
  }
  for (const root of roots) await visit(root);
  return files;
}

export function compatibilityDatabase(dataRoot: string) {
  const database = new DatabaseSync(path.join(dataRoot, 'decision-cases.sqlite3'), { readOnly: true });
  try {
    const schema = database.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
    const tables: Record<string, string[]> = {};
    for (const entry of schema) if (entry.type === 'table') {
      const name = String(entry.name);
      tables[name] = database.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all().map(row => JSON.stringify(row)).sort();
    }
    return { schema, tables };
  } finally { database.close(); }
}

export async function compatibilityRun(host: Host, provider: Provider, projectId: string, taskId: string, input: { text: string; requestId: string; caseContext?: unknown; requirementContext?: unknown }, answer: string) {
  provider.setChunks([answer]);
  const stream = await sessionEvents(host, projectId, taskId);
  try {
    await readJson(await host.request(`/api/projects/${projectId}/tasks/${taskId}/messages`, 'POST', input), 202);
    const terminal = await stream.terminal;
    assert.equal(terminal.type, 'run.settled');
    if (terminal.type === 'run.settled') assert.equal(terminal.outcome, 'completed');
    return await readJson(await host.request(`/api/projects/${projectId}/tasks/${taskId}`));
  } finally { await stream.close(); }
}

export async function prepareSessionCompatibility(host: Host, provider: Provider) {
  assert.ok(host.dataRoot.includes('optracall-host-test-'), 'compatibility writes stay in an isolated synthetic root');
  const startupFile = path.join(host.dataRoot, 'synthetic-worker-starts.txt');
  const extension = path.join(host.dataRoot, 'pi', 'extensions');
  await mkdir(extension, { recursive: true });
  await writeFile(path.join(extension, 'compatibility-starts.ts'), `import { appendFileSync } from 'node:fs'; export default function(pi) { pi.on('session_start', () => { appendFileSync(${JSON.stringify(startupFile)}, 'started\\n'); }); }\n`);
  const joint = await prepareJointContext(host, provider.baseUrl);
  const route = `/api/projects/${joint.project.id}/tasks/${joint.task.id}`;
  const requirementRoute = `/api/requirement-instances/${joint.requirementContext.instanceId}`;
  const draft = await readJson(await host.request(requirementRoute));
  draft.instance.context.goal = 'SM11_LATEST_DESCRIPTIVE_RAP_GOAL';
  draft.instance.hypotheses = [];
  draft.instance.framework.analysisPaths = draft.instance.framework.analysisPaths.map((item: any) => ({ ...item, hypothesis: '' }));
  await readJson(await host.request(requirementRoute, 'PATCH', { instance: draft.instance }));
  await readJson(await host.request(requirementRoute + '/confirm', 'POST', { confirmedBy: 'synthetic-compatibility-reviewer' }));
  await readJson(await host.request(requirementRoute + '/publish', 'POST', { version: '1.11.0', releasedBy: 'synthetic-compatibility-reviewer' }), 201);
  const requirementContext = { ...joint.requirementContext, version: '1.11.0' };

  await readJson(await host.request(`/api/projects/${joint.project.id}/files/upload`, 'POST', { name: 'retained-original.txt', directory: '010_draw', content: Buffer.from('SM11_SYNTHETIC_ORIGINAL_BYTES').toString('base64') }), 201);
  await readJson(await host.request(`/api/projects/${joint.project.id}/files/save-report`, 'POST', { name: 'retained-report.md', text: '# SM11_SYNTHETIC_REPORT_BYTES' }), 201);
  const first = { text: 'SM11_FIRST_SELECTED_CONTEXT', requestId: randomUUID(), caseContext: joint.caseContext, requirementContext };
  await compatibilityRun(host, provider, joint.project.id, joint.task.id, first, 'SM11_FIRST_NATIVE_ANSWER');
  const second = { text: 'SM11_SECOND_UNFORKED_CONTEXT', requestId: randomUUID() };
  const beforeFork = await compatibilityRun(host, provider, joint.project.id, joint.task.id, second, 'SM11_SECOND_NATIVE_ANSWER');
  const selected = await readJson(await host.request(route + '/commands', 'POST', { text: '/fork', requestId: randomUUID() }));
  const entry = selected.result.entries.find((item: any) => item.text === second.text);
  assert.ok(entry?.entryId, 'fork uses the real native selector');
  const forked = await readJson(await host.request(route + '/commands', 'POST', { text: `/fork ${entry.entryId}`, requestId: randomUUID() }));
  assert.notEqual(forked.snapshot.sessionFile, beforeFork.task.sessionFile);
  const branch = { text: 'SM11_BRANCH_LATEST_CONTEXT', requestId: randomUUID() };
  await compatibilityRun(host, provider, joint.project.id, joint.task.id, branch, 'SM11_BRANCH_NATIVE_ANSWER');
  await readJson(await host.request(route + '/draft', 'PATCH', { text: 'SM11_RETAINED_UNSENT_TASK_DRAFT' }));

  const task = await readJson(await host.request(route));
  const nativeFile = task.task.sessionFile as string;
  const nativeBytes = await readFile(nativeFile);
  const parentFile = beforeFork.task.sessionFile as string;
  const header = JSON.parse(nativeBytes.toString().split('\n')[0]!);
  assert.equal(header.parentSession, parentFile);
  const payload = JSON.stringify(provider.requests[0]!.body);
  assert.match(payload, /SM11_LATEST_DESCRIPTIVE_RAP_GOAL/);
  assert.match(payload, /RR07_CASE_CURRENT_JUDGEMENT/);
  assert.match(payload, /membership-repurchase@1\.0\.0/);
  return {
    projectId: joint.project.id, taskId: joint.task.id, caseId: joint.case.id,
    requirementId: joint.requirementContext.instanceId, projectRoot: joint.project.rootPath as string,
    route, requirementRoute, nativeFile, parentFile, startupFile, task,
    nativeBytes: nativeBytes.toString('base64'), parentBytes: (await readFile(parentFile)).toString('base64'),
    starts: await readFile(startupFile, 'utf8'), branch, first, requirementContext,
    caseDetail: await readJson(await host.request(`/api/cases/${joint.case.id}`)),
    work: await readJson(await host.request(`/api/projects/${joint.project.id}/work`)),
    enabledSap: await readJson(await host.request(`/api/metric-factory/projects/${joint.project.id}`)),
    rapOld: await readJson(await host.request(requirementRoute + '/releases/1.9.0')),
    rapLatest: await readJson(await host.request(requirementRoute + '/releases/1.11.0')),
    requirementDraft: await readJson(await host.request(requirementRoute)),
  };
}

export type SessionCompatibility = Awaited<ReturnType<typeof prepareSessionCompatibility>>;

/** Actual HTTP readback, suitable for the current Host or a stopped-version
 * compatibility rehearsal. Callers also compare stopped files/SQLite snapshots. */
export async function readSessionCompatibility(host: Host, expected: SessionCompatibility, requestCount: () => number) {
  const before = requestCount();
  const detail = await readJson(await host.request(expected.route));
  assert.equal(detail.task.id, expected.taskId);
  assert.equal(detail.task.sessionFile, expected.nativeFile);
  assert.equal(detail.task.draft, 'SM11_RETAINED_UNSENT_TASK_DRAFT');
  assert.deepEqual(detail.task, expected.task.task);
  assert.deepEqual(detail.snapshot.messages, expected.task.snapshot.messages);
  assert.equal(detail.project.rootPath, expected.projectRoot);
  assert.deepEqual(detail.project.uploads, expected.task.project.uploads);
  assert.deepEqual(await readJson(await host.request(`/api/cases/${expected.caseId}`)), expected.caseDetail);
  assert.deepEqual(await readJson(await host.request(`/api/projects/${expected.projectId}/work`)), expected.work);
  assert.deepEqual(await readJson(await host.request(`/api/metric-factory/projects/${expected.projectId}`)), expected.enabledSap);
  assert.deepEqual(await readJson(await host.request(expected.requirementRoute + '/releases/1.9.0')), expected.rapOld);
  assert.deepEqual(await readJson(await host.request(expected.requirementRoute + '/releases/1.11.0')), expected.rapLatest);
  assert.deepEqual(await readJson(await host.request(expected.requirementRoute)), expected.requirementDraft);
  assert.equal(expected.rapLatest.rap.analysisPaths[0].hypothesis, '', 'rollback must accept the already-supported empty hypothesis reference');
  assert.deepEqual(await readFile(expected.nativeFile), Buffer.from(expected.nativeBytes, 'base64'));
  assert.deepEqual(await readFile(expected.parentFile), Buffer.from(expected.parentBytes, 'base64'));
  assert.equal(await readFile(expected.startupFile, 'utf8'), expected.starts, 'passive readback must not start a worker');
  assert.equal(requestCount(), before, 'passive readback must not send a model request');
  return detail;
}
