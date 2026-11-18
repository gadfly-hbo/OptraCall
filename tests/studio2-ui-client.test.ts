import assert from 'node:assert/strict';
import test from 'node:test';
import * as studio from '../src/host/ui/studio-api.ts';
const { createStudioSystem, StudioRequestError } = studio;

test('enterprise construction rejects a receipt for a different enterprise instead of opening its task', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ system: { id: 's1', projectId: 'p1', enterpriseId: 'enterprise-other' } }), { status: 200 }));
  await assert.rejects(createStudioSystem({ requestId: 'build-one', enterpriseId: 'enterprise-a', projectId: 'p1', name: '企业基础资产', goal: '建设基础口径', topicTitle: '基础层' }), error => error instanceof StudioRequestError && error.code === 'studio_response_mismatch');
});

test('maintenance workspace validates the active execution task while preserving the original construction owner', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ system: { id: 's1', projectId: 'original', taskId: 'original-task', maintenanceOwner: { projectId: 'maintenance', taskId: 'maintenance-task' } }, project: { id: 'maintenance' }, task: { id: 'maintenance-task' }, running: false }), { status: 200 }));
  const workspace = await studio.readStudioWorkspace('s1');
  assert.equal(workspace.system.projectId, 'original');
  assert.equal(workspace.project.id, 'maintenance');
  assert.equal(workspace.task.id, 'maintenance-task');
});

test('foundation response cannot substitute a different enterprise or mix its assets into the current view', async t => {
  let request = '';
  t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0]) => {
    request = String(url);
    return new Response(JSON.stringify({ enterprise: { id: 'ea', name: 'A' }, systems: [], items: [{ authority: 'sap-metric', id: 'foreign-metric', enterpriseId: 'eb' }], unassigned: [] }), { status: 200 });
  });
  await assert.rejects(studio.readStudioFoundation('ea'), error => error instanceof StudioRequestError && error.code === 'studio_response_mismatch');
  assert.equal(request, '/api/studio/foundation?enterpriseId=ea');
});

test('lost enterprise association reply preserves its original intent without replaying the asset write', async t => {
  const requests: Record<string, unknown>[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => { requests.push(JSON.parse(String(init?.body))); throw new TypeError('lost reply'); });
  await assert.rejects(studio.associateStudioEnterprise({ requestId: 'associate-original', kind: 'asset', entityId: 'method-one', enterpriseId: 'ea', authority: 'sap-method' }), error => error instanceof StudioRequestError && error.uncertain);
  assert.deepEqual(requests, [{ requestId: 'associate-original', kind: 'asset', entityId: 'method-one', enterpriseId: 'ea', authority: 'sap-method' }]);
});

test('ordinary analysis feedback discovers only systems supplied for its real source project', async t => {
  let request = '';
  t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0]) => { request = String(url); return new Response(JSON.stringify({ systems: [] }), { status: 200 }); });
  await studio.listStudioSystems(undefined, 'p one');
  assert.equal(request, '/api/studio/systems?projectId=p%20one');
});

test('an exact professional source derives its unique enterprise from the authoritative foundation catalogue without writing an assignment', async t => {
  const directory = { enterprises: ['ea', 'eb'].map(id => ({ id, name: id, revision: 1, createdAt: '2026-11-12' })), projectAssignments: [], caseAssignments: [], assetAssignments: [] };
  const requests: { url: string; method: string | undefined }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    requests.push({ url: String(url), method: init?.method });
    const enterpriseId = new URL(String(url), 'http://localhost').searchParams.get('enterpriseId');
    return new Response(JSON.stringify({ enterprise: { id: enterpriseId }, systems: [], unassigned: [], items: enterpriseId === 'eb' ? [{ authority: 'sap-method', id: 'native-method', version: '2', title: '准确原方法', status: 'formal-history', enterpriseId: 'eb' }] : [] }));
  });
  assert.equal(await studio.resolveStudioProfessionalEnterprise(directory, { authority: 'sap-method', id: 'native-method', version: 2 }), 'eb');
  assert.equal(requests.length, 2);
  assert(requests.every(request => request.method === 'GET'));
});

test('professional ownership never substitutes another version or accepts an ambiguous catalogue owner', async t => {
  const directory = { enterprises: ['ea', 'eb'].map(id => ({ id, name: id, revision: 1, createdAt: '2026-11-12' })), projectAssignments: [], caseAssignments: [], assetAssignments: [] };
  t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0]) => {
    const enterpriseId = new URL(String(url), 'http://localhost').searchParams.get('enterpriseId');
    return new Response(JSON.stringify({ enterprise: { id: enterpriseId }, systems: [], unassigned: [], items: [{ authority: 'sap-method', id: 'native-method', version: '2', title: '方法', status: 'formal-current', enterpriseId }] }));
  });
  assert.equal(await studio.resolveStudioProfessionalEnterprise(directory, { authority: 'sap-method', id: 'native-method', version: 2 }), undefined);
  assert.equal(await studio.resolveStudioProfessionalEnterprise(directory, { authority: 'sap-method', id: 'native-method', version: 1 }), undefined);
});

test('canceling an accurate-source ownership lookup preserves abort instead of returning a late enterprise', async t => {
  const controller = new AbortController();
  const directory = { enterprises: [{ id: 'ea', name: 'A', revision: 1, createdAt: '2026-11-12' }], projectAssignments: [], caseAssignments: [], assetAssignments: [] };
  t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => { assert.equal(init?.signal, controller.signal); throw new DOMException('canceled', 'AbortError'); });
  controller.abort();
  await assert.rejects(studio.resolveStudioProfessionalEnterprise(directory, { authority: 'sap-method', id: 'native-method', version: 1 }, controller.signal), { name: 'AbortError' });
});
