import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { ProjectStore } from '../../src/host/project-store.ts';
import { EnterpriseMaterialsStore } from '../../src/host/enterprise-materials-store.ts';
import { createStudioFeature } from '../../src/host/studio-host.ts';
import type { StudioSourceRef } from '../../extensions/business-plugins/studio/contracts.ts';

export const coveragePolicyRef = { authority: 'enterprise' as const, id: 'synthetic-policy', version: 'r1' };
export function coverageReport(scope: { enterpriseId: string; systemId: string; topicId: string }, ref: StudioSourceRef = coveragePolicyRef) {
  return {
    reportProfile: 'studio-coverage/1',
    scope: { ...scope, purpose: 'Synthetic business coverage only', included: ['Membership'], excluded: ['Production data'] },
    methodRefs: [], basisRefs: [ref], focusCells: [{ row: 1, column: 'What' }],
    observations: [{ id: 'observation-1', subjectLabel: 'Membership', description: 'Synthetic policy observation', annotations: [{ cell: { row: 6, column: 'When' }, reason: 'Actual time evidence is outside the focus set' }], evidenceRefs: [ref], evidenceStatus: 'located' }],
    questions: [], limitations: ['Synthetic evidence does not establish business acceptance'],
  };
}
export const coverageScope = () => ({ enterpriseId: randomUUID(), systemId: randomUUID(), topicId: randomUUID() });

export async function coverageHostFixture(t: { after(fn: () => Promise<void>): void }) {
  const base = path.resolve('.local/studio-business-coverage-implementation/tdd-backend/host'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'host-')), dataRoot = path.join(root, 'data');
  const projects = new ProjectStore({ dataRoot, projectsRoot: path.join(root, 'projects') }); await projects.init();
  const configuration = { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' };
  const project = await projects.create({ name: 'Synthetic coverage', configuration });
  const task = await projects.createTask(project.id, { name: 'Coverage construction' });
  const enterpriseMaterials = new EnterpriseMaterialsStore(dataRoot);
  const studio = createStudioFeature({ dataRoot, projects, enterpriseMaterials, readBody: async request => { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); return JSON.parse(Buffer.concat(chunks).toString('utf8')); }, mutate: async operation => operation(), running: () => false, closing: () => false, readTaskReply: async () => ({ text: 'Synthetic native report' }) });
  const enterprise = studio.enterpriseScopes.create({ name: 'Synthetic enterprise' }); studio.enterpriseScopes.associateProject(project.id, enterprise.id);
  const created = await enterpriseMaterials.create({ title: 'Synthetic policy', body: 'Membership policy section 2: Membership belongs to a program.' });
  await enterpriseMaterials.enable(created.material.id, created.material.version); studio.enterpriseScopes.associateAsset('enterprise', created.material.id, enterprise.id);
  const context = { requestId: randomUUID(), sessionId: randomUUID(), toolCallId: randomUUID(), signal: new AbortController().signal, assertCurrent() {} };
  const port = studio.port(project.id, task.id);
  const catalog = (await port('catalog', {}, context)).details.result as any;
  const ref = catalog.items.find((item: any) => item.id === created.material.id)?.ref as StudioSourceRef; assertRef(ref);
  const system = studio.store.create({ name: 'Coverage system', projectId: project.id, taskId: task.id, enterpriseId: enterprise.id, goal: 'Synthetic coverage', topicTitle: 'Synthetic scope' });
  const report = coverageReport({ enterpriseId: enterprise.id, systemId: system.id, topicId: system.currentTopicId }, ref);
  const server = createServer(async (request, response) => { if (!await studio.handle(request, response, new URL(request.url!, 'http://localhost'))) { response.writeHead(404); response.end(); } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number }, origin = `http://127.0.0.1:${address.port}`;
  const http = async (route: string, input?: unknown) => { const response = await fetch(origin + route, input === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); return { status: response.status, body: await response.json() as any }; };
  const save = async (body: unknown = report, extra: Record<string, unknown> = {}) => {
    const result = (await port('save-asset', { systemId: system.id, payload: { kind: 'business', title: 'Coverage report', body: typeof body === 'string' ? body : JSON.stringify(body), scope: 'Synthetic coverage', sources: [], checks: [{ name: 'Synthetic author check', status: 'pass', detail: 'Not independent business verification' }], readyForPublication: true, ...extra } }, context)).details.result as any;
    const asset = studio.store.get(system.id).assets.find(asset => asset.id === result.asset.id)!;
    const revision = asset.revisions.at(-1)!;
    return { asset, revision, ref: { authority: 'studio-source' as const, id: asset.id, version: String(revision.revision), sha256: revision.sha256, projectId: system.projectId, locator: system.id } };
  };
  const prepare = async (assetIds: string[]) => ((await port('prepare-publication', { systemId: system.id, payload: { assetIds, summary: 'Synthetic shared coverage', scope: 'Synthetic coverage only' } }, context)).details.result as any).preview;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await projects.close(); });
  return { root, dataRoot, projects, project, task, enterpriseMaterials, created, studio, enterprise, context, port, ref, system, report, save, prepare, http };
}
function assertRef(ref: StudioSourceRef | undefined): asserts ref is StudioSourceRef { if (!ref) throw new Error('Synthetic original catalog source missing'); }
