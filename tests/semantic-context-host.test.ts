import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { readJson } from './fixtures/joint-context.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';
import { sessionEvents } from './fixtures/session-events.ts';

test('L1 ordinary task may query an empty semantic directory without opening an Agent or requiring materials', { timeout: 30_000 }, async t => {
  const root = path.resolve('.local/fourbase-modules/m7-l1-semantic-trace/implementation/host-fixtures', randomUUID());
  await mkdir(root, { recursive: true });
  const host = await startTestHost({ dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects') });
  t.after(() => host.close());
  await readJson(await host.request('/api/configuration', 'PUT', {
    name: 'L1 isolated synthetic configuration', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1', model: 'synthetic', apiKey: 'synthetic-l1-not-a-credential',
  }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: 'L1 no Case or semantic assets' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: 'Original analysis remains available' }), 201);
  const result = await readJson(await host.request(`/api/projects/${project.id}/tasks/${task.id}/semantic-context`, 'POST', { action: 'find' }));
  assert.equal(result.type, 'optracall.semantic-context-result');
  assert.deepEqual(result.items, []);
  const current = await readJson(await host.request(`/api/projects/${project.id}/tasks/${task.id}`));
  assert.equal(current.snapshot.capabilities.uninitialized, true, 'a history/source query must not open an Agent');
  assert.deepEqual(current.snapshot.messages, []);
  assert.deepEqual(current.snapshot.tools, []);
  assert.equal(current.task.sessionFile, undefined);
});

test('an ordinary Agent explicitly saves a report source through the original M2 citation store and history survives reopening', { timeout: 40_000 }, async t => {
  const root = path.resolve('.local/fourbase-modules/m7-l1-semantic-trace/implementation/host-fixtures', randomUUID());
  await mkdir(root, { recursive: true });
  const provider = await startToolProvider(); t.after(() => provider.close());
  let host = await startTestHost({ dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects') });
  t.after(() => host.close());
  await readJson(await host.request('/api/configuration', 'PUT', { name: 'Synthetic source recording', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic', apiKey: 'synthetic-l1-only' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: 'L1 synthetic report' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: 'No manual source-entry step' }), 201);
  const text = 'Synthetic completed report. Its author declares sources; professional correctness remains unverified.';
  const reportPath = '060_reports/l1-source-record.md';
  await writeFile(path.join(project.rootPath, reportPath), text);
  const operationId = randomUUID();
  provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: 'The report completed. Source recording is auxiliary and does not prove calculation correctness.' } : { calls: [{ name: 'record_analysis_sources', arguments: { operationId, citationId: operationId, baseIndexRevision: 0, report: { path: reportPath, sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text) }, attachments: [], selections: [], conceptRefs: [], sapRefs: [], declaration: 'Explicit synthetic Agent author declaration.' } }] });
  const stream = await sessionEvents(host, project.id, task.id);
  try {
    await readJson(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', { requestId: randomUUID(), text: 'Read existing synthetic report and explicitly keep its declared source identity.' }), 202);
    const terminal = await stream.terminal;
    assert.equal(terminal.type, 'run.settled');
    if (terminal.type === 'run.settled') assert.equal(terminal.outcome, 'completed');
  } finally { await stream.close(); }
  const summary = await readJson(await host.request(`/api/projects/${project.id}/data-context`));
  assert.equal(summary.citations.length, 1, 'the Agent must reach the original citation store, not merely say it saved');
  assert.equal(summary.citations[0].citationId, operationId);
  assert.equal(summary.citations[0].declarer, 'agent');
  const finishTurn = async (question: string) => {
    const events = await sessionEvents(host, project.id, task.id);
    try {
      await readJson(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', { requestId: randomUUID(), text: question }), 202);
      const settled = await events.terminal; assert.equal(settled.type, 'run.settled');
      if (settled.type === 'run.settled') assert.equal(settled.outcome, 'completed');
    } finally { await events.close(); }
  };
  provider.setResponder(({ recentToolResults }) => recentToolResults.length === 0 ? { calls: [{ name: 'read_semantic_context', arguments: { action: 'trace', target: { kind: 'data-citation', projectId: project.id, citationId: operationId } } }] }
    : recentToolResults.length === 1 ? { calls: [{ name: 'bash', arguments: { command: "python3 -c 'print(6 * 7)'" } }] }
    : { text: 'Exact declared references were read. The real Python result is 42; professional adoption remains unverified.' });
  await finishTurn('Read the existing exact source declaration, then continue ordinary Python analysis.');
  const failedOperation = randomUUID();
  provider.setResponder(({ recentToolResults }) => recentToolResults.length === 0 ? { calls: [{ name: 'read_semantic_context', arguments: { action: 'find', recordedBefore: '2026-10-01' } }] }
    : recentToolResults.length === 1 ? { calls: [{ name: 'bash', arguments: { command: "python3 -c 'print(6 * 7)'" } }] }
    : recentToolResults.length === 2 ? { calls: [{ name: 'record_analysis_sources', arguments: { operationId: failedOperation, citationId: failedOperation, baseIndexRevision: 1, report: { path: reportPath, sha256: '0'.repeat(64), bytes: Buffer.byteLength(text) }, attachments: [], selections: [], conceptRefs: [], sapRefs: [], declaration: 'Intentionally failing synthetic source save.' } }] }
    : { text: 'Python still completed with 42. Optional semantic query and source save failed; provenance gaps remain explicit.' });
  await finishTurn('Auxiliary query/save failures must not stop the already-available original calculation.');
  assert.equal((await readJson(await host.request(`/api/projects/${project.id}/data-context`))).citations.length, 1, 'failed optional saving must not invent a second citation');
  assert.equal(await readFile(path.join(project.rootPath, reportPath), 'utf8'), text);
  const native = (await readJson(await host.request(`/api/projects/${project.id}/tasks/${task.id}`))).task.sessionFile;
  const bytes = await readFile(native);
  const entries = bytes.toString().trim().split('\n').map(line => JSON.parse(line));
  const receipt = entries.find(entry => entry.message?.role === 'toolResult' && entry.message.toolName === 'record_analysis_sources');
  assert.equal(receipt?.message.details.type, 'optracall.analysis-sources-recorded');
  assert.equal(receipt?.message.details.claim, 'author-declaration-not-verification');
  const query = entries.find(entry => entry.message?.role === 'toolResult' && entry.message.toolName === 'read_semantic_context' && !entry.message.isError);
  assert.equal(query?.message.details.type, 'optracall.semantic-context-result');
  assert.equal(query?.message.details.items[0]?.declaration?.text, 'Explicit synthetic Agent author declaration.');
  const results = entries.filter(entry => entry.message?.role === 'toolResult').map(entry => entry.message);
  assert.ok(results.some(message => message.toolName === 'read_semantic_context' && message.isError));
  assert.ok(results.some(message => message.toolName === 'record_analysis_sources' && message.isError));
  assert.equal(results.filter(message => message.toolName === 'bash' && !message.isError && JSON.stringify(message.content).includes('42')).length, 2);
  await host.close();
  host = await startTestHost({ dataRoot: host.dataRoot, projectsRoot: host.projectsRoot });
  const reopened = await readJson(await host.request(`/api/projects/${project.id}/data-context`));
  assert.deepEqual(reopened.citations, summary.citations);
  assert.deepEqual(await readFile(native), bytes);
});
