import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {startTestHost} from './fixtures/host-process.ts';
import {startToolProvider} from './fixtures/tool-provider.ts';

const stores = {kind: 'department' as const, id: 'east-retail', name: '华东零售事业部', enterpriseId: 'ent-1'};
const scopeKey = 'department:ent-1:east-retail';
const blocks = [{id: 'B1', label: '定位', text: '深耕门店。'}];

test('真实 Host+Pi：配置变化失败后显式替换恢复，重启不卡死', {timeout: 150_000}, async t => {
  const provider = await startToolProvider();
  const scratch = await mkdtemp(join(os.tmpdir(), 'optracall-recovery-'));
  const options = {dataRoot: join(scratch, 'host'), projectsRoot: join(scratch, 'projects')};
  let host = await startTestHost(options);
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  const configInput = {name: '恢复测试', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-recovery', apiKey: 'synthetic-recovery'};
  await req('/api/configuration', 'PUT', configInput);
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '恢复事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const session = (await req(`${base}/session`, 'POST', {operationId: randomUUID(), scope: stores}, 201)).session;
  const sessionRoute = `${base}/session?scopeKey=${encodeURIComponent(scopeKey)}`;
  const messageRoute = `${base}/messages?scopeKey=${encodeURIComponent(scopeKey)}`;
  provider.setResponder(() => ({text: '收到。'}));

  await req('/api/configuration', 'PUT', {...configInput, id: session.configurationId, baseUrl: 'http://127.0.0.1:14998/v1'});
  const failedRequestId = randomUUID();
  assert.equal((await req(messageRoute, 'POST', {requestId: failedRequestId, text: '开始开题。', expectedRevision: 1}, 409)).code, 'configuration_changed');
  let detail = await req(sessionRoute);
  assert.equal(detail.session.lastRun.status, 'failed');
  assert.equal(detail.session.pendingInput.requestId, failedRequestId, 'original request and true terminal state are preserved');
  assert.equal((await req(messageRoute, 'POST', {requestId: randomUUID(), text: '新输入。', expectedRevision: detail.session.revision}, 409)).code, 'strategy_initiative_pending_request');

  await req('/api/configuration', 'PUT', {...configInput, id: session.configurationId});
  const replaced = await req(messageRoute, 'POST', {requestId: randomUUID(), text: '恢复后继续开题。', expectedRevision: detail.session.revision, replacePendingRequestId: failedRequestId}, 202);
  assert.ok(replaced.requestId);
  for (let n = 0; n < 300; n++) { detail = await req(sessionRoute); if (detail.session.lastRun?.status === 'completed') break; await delay(20); }
  assert.equal(detail.session.lastRun.status, 'completed');
  assert.equal(detail.session.pendingInput, undefined);

  await host.close();
  host = await startTestHost(options);
  detail = await req(sessionRoute);
  assert.equal(detail.session.lastRun.status, 'completed', 'restart reads back the recovered terminal state');
  await req(messageRoute, 'POST', {requestId: randomUUID(), text: '重启后继续。', expectedRevision: detail.session.revision}, 202);
  for (let n = 0; n < 300; n++) { detail = await req(sessionRoute); if (detail.session.lastRun?.status === 'completed' && detail.session.revision > 3) break; await delay(20); }
  assert.equal(detail.session.lastRun.status, 'completed');

  const fields = {horizon: '2027–2029', diagnosis: '缺口。', propositions: [{id: 'P1', question: 'q1', whyItMatters: 'w1'}, {id: 'P2', question: 'q2', whyItMatters: 'w2'}, {id: 'P3', question: 'q3', whyItMatters: 'w3'}], assumptions: '', evidenceGaps: '', followUp: ''};
  const report = (await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields, sources: []}, 201)).version;
  await req(`${base}/reports/1/lock`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256});
  await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256, scope: stores});
  const created = await req(`${base}/candidates`, 'POST', {operationId: randomUUID(), scope: stores, title: '恢复候选', instruction: '形成方案。'}, 202);
  const cid = created.candidate.candidateId;
  let cd: any;
  for (let n = 0; n < 300; n++) { cd = await req(`${base}/candidates/${cid}/versions/1`); if (cd.candidate.lastRun?.status === 'completed') break; await delay(20); }
  assert.equal(cd.candidate.lastRun.status, 'completed');
  await req('/api/configuration', 'PUT', {...configInput, id: cd.candidate.configurationId, baseUrl: 'http://127.0.0.1:14998/v1'});
  const candFailedId = randomUUID();
  assert.equal((await req(`${base}/candidates/${cid}/versions/1/messages`, 'POST', {requestId: candFailedId, text: '补充。', expectedRevision: cd.candidate.revision}, 409)).code, 'configuration_changed');
  cd = await req(`${base}/candidates/${cid}/versions/1`);
  assert.equal(cd.candidate.lastRun.status, 'failed');
  assert.equal((await req(`${base}/candidates/${cid}/versions/1/messages`, 'POST', {requestId: randomUUID(), text: '新输入。', expectedRevision: cd.candidate.revision}, 409)).code, 'strategy_candidate_pending_request');
  await req('/api/configuration', 'PUT', {...configInput, id: cd.candidate.configurationId});
  await req(`${base}/candidates/${cid}/versions/1/messages`, 'POST', {requestId: randomUUID(), text: '恢复后补充。', expectedRevision: cd.candidate.revision, replacePendingRequestId: candFailedId}, 202);
  for (let n = 0; n < 300; n++) { cd = await req(`${base}/candidates/${cid}/versions/1`); if (cd.candidate.lastRun?.status === 'completed') break; await delay(20); }
  assert.equal(cd.candidate.lastRun.status, 'completed');
  assert.equal(cd.candidate.pendingInput, undefined);
  assert.deepEqual(provider.errors, []);
});
test('真实 Host+Pi：运行中 Host 崩溃后重启，中断请求可显式替换且不重派', {timeout: 150_000}, async t => {
  const provider = await startToolProvider();
  const scratch = await mkdtemp(join(os.tmpdir(), 'optracall-crash-'));
  const options = {dataRoot: join(scratch, 'host'), projectsRoot: join(scratch, 'projects')};
  let host = await startTestHost(options);
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  const configInput = {name: '崩溃恢复', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-crash', apiKey: 'synthetic-crash'};
  await req('/api/configuration', 'PUT', configInput);
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '崩溃事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const fields = {horizon: '2027–2029', diagnosis: '缺口。', propositions: [{id: 'P1', question: 'q1', whyItMatters: 'w1'}, {id: 'P2', question: 'q2', whyItMatters: 'w2'}, {id: 'P3', question: 'q3', whyItMatters: 'w3'}], assumptions: '', evidenceGaps: '', followUp: ''};
  const report = (await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields, sources: []}, 201)).version;
  await req(`${base}/reports/1/lock`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256});
  await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256, scope: stores});
  await req(`${base}/session`, 'POST', {operationId: randomUUID(), scope: stores}, 201);
  const sessionRoute = `${base}/session?scopeKey=${encodeURIComponent(scopeKey)}`;
  const messageRoute = `${base}/messages?scopeKey=${encodeURIComponent(scopeKey)}`;
  provider.setResponder(() => ({text: '等待', hold: true}));
  const mainRequestId = randomUUID();
  await req(messageRoute, 'POST', {requestId: mainRequestId, text: '开始开题。', expectedRevision: 1}, 202);
  const created = await req(`${base}/candidates`, 'POST', {operationId: randomUUID(), scope: stores, title: '中断候选', instruction: '形成方案。'}, 202);
  const cid = created.candidate.candidateId;
  const candRequestId = created.requestId;
  await provider.waitForRequests(2);
  process.kill(host.pid!, 'SIGKILL');
  await delay(500);
  host = await startTestHost(options);
  let detail = await req(sessionRoute);
  assert.equal(detail.session.lastRun.status, 'accepted', 'interrupted request keeps its true accepted state');
  assert.equal(detail.session.pendingInput.requestId, mainRequestId);
  assert.equal(detail.busy, false);
  const requests = provider.requests.length;
  const replay = await req(messageRoute, 'POST', {requestId: mainRequestId, text: '开始开题。', expectedRevision: 1}, 202);
  assert.equal(replay.replayed, true);
  assert.equal(provider.requests.length, requests, 'original id reads back without redispatch');
  assert.equal((await req(messageRoute, 'POST', {requestId: randomUUID(), text: '新输入。', expectedRevision: detail.session.revision}, 409)).code, 'strategy_initiative_pending_request');
  provider.setResponder(() => ({text: '恢复完成。'}));
  const mainReplacement = randomUUID();
  await req(messageRoute, 'POST', {requestId: mainReplacement, text: '中断后继续。', expectedRevision: detail.session.revision, replacePendingRequestId: mainRequestId}, 202);
  for (let n = 0; n < 300; n++) { detail = await req(sessionRoute); if (detail.session.lastRun?.status === 'completed') break; await delay(20); }
  assert.equal(detail.session.lastRun.status, 'completed');
  assert.equal(detail.session.pendingInput, undefined);
  let cd = await req(`${base}/candidates/${cid}/versions/1`);
  assert.equal(cd.candidate.lastRun.status, 'accepted');
  assert.equal(cd.candidate.pendingInput.requestId, candRequestId);
  assert.equal((await req(`${base}/candidates/${cid}/versions/1/messages`, 'POST', {requestId: randomUUID(), text: '新输入。', expectedRevision: cd.candidate.revision}, 409)).code, 'strategy_candidate_pending_request');
  const candidateReplacement = randomUUID();
  const candidateMessages = `${base}/candidates/${cid}/versions/1/messages`;
  await req(candidateMessages, 'POST', {requestId: candidateReplacement, text: '中断后继续。', expectedRevision: cd.candidate.revision, replacePendingRequestId: candRequestId}, 202);
  for (let n = 0; n < 300; n++) { cd = await req(`${base}/candidates/${cid}/versions/1`); if (cd.candidate.lastRun?.status === 'completed') break; await delay(20); }
  assert.equal(cd.candidate.lastRun.status, 'completed');
  assert.equal(cd.candidate.pendingInput, undefined);
  assert.equal(provider.requests.length, requests + 2, 'only the two explicit replacements dispatch');

  await host.close();
  host = await startTestHost(options);
  for (const [route, originalId, originalText, replacementId, conflictCode] of [
    [messageRoute, mainRequestId, '开始开题。', mainReplacement, 'strategy_initiative_operation_conflict'],
    [candidateMessages, candRequestId, '形成方案。', candidateReplacement, 'strategy_candidate_operation_conflict'],
  ]) {
    const original = {requestId: originalId, text: originalText, expectedRevision: 1};
    const reread = await req(route, 'POST', original, 202);
    assert.equal(reread.replayed, true);
    assert.equal(reread.receipt.requestId, originalId);
    assert.equal(reread.receipt.text, originalText);
    assert.equal(reread.receipt.expectedRevision, 1);
    assert.equal(reread.receipt.status, 'unknown');
    assert.equal(reread.receipt.replacedBy, replacementId);
    assert.equal((await req(route, 'POST', {...original, text: '不同输入。'}, 409)).code, conflictCode);
  }
  assert.equal(provider.requests.length, requests + 2, 'persisted original receipts are read without dispatching');
  assert.deepEqual(provider.errors, []);
});
