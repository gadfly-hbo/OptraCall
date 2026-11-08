import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ProjectStore } from '../src/host/project-store.ts';
import { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';

test('a revoked source-recording operation cannot publish a citation or create its index', async t => {
  const root = path.resolve('.local/fourbase-modules/m7-l1-semantic-trace/implementation/source-write', randomUUID());
  const projects = new ProjectStore({ dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects') });
  await projects.init(); t.after(() => projects.close());
  const project = await projects.create({ name: 'Synthetic source preservation', configuration: { id: 'synthetic', revision: 1, name: 'synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:9' } });
  const report = await projects.saveReport(project.id, 'source-guard.md', 'The analysis completed; optional provenance may be unavailable.');
  const current = await projects.observeFile(project.id, report.path);
  const data = new ProjectDataContextStore({ dataRoot: projects.dataRoot, projects });
  const operationId = randomUUID();
  const input = { operationId, citationId: operationId, baseIndexRevision: 0, report: { path: report.path, sha256: current.sha256, bytes: current.bytes }, attachments: [], selections: [], conceptRefs: [], sapRefs: [], declarer: 'agent' as const, declaration: 'Explicit author declaration, not verification.' };
  await assert.rejects(data.createCitation(project.id, input, { assertWritable: () => { throw new Error('source_operation_revoked'); } }), /source_operation_revoked/);
  assert.equal(await data.getIndex(project.id), null);
  assert.equal((await projects.readFile(project.id, report.path)).bytes.toString(), 'The analysis completed; optional provenance may be unavailable.');
});
