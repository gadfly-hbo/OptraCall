import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile, mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {startTestHost} from './fixtures/host-process.ts';
import {startToolProvider, providerMessageText} from './fixtures/tool-provider.ts';

const stores = {kind: 'department' as const, id: 'east-retail', name: '华东零售事业部', enterpriseId: 'ent-1'};
const scopeKey = 'department:ent-1:east-retail';
const kickoffFields = {
  horizon: '2027–2029',
  diagnosis: '华东门店客流企稳，增长缺口集中在新客首购后二次到店。',
  propositions: [
    {id: 'P1', question: '复购提升能否驱动存量门店增长？', whyItMatters: '决定资源投向会员还是开店。', evidence: '上期复盘 90 天二购率约 9%。', gaps: '自然复购对照缺失。'},
    {id: 'P2', question: '导购触达能否用可控工时规模化？', whyItMatters: '决定试点能否推广。'},
    {id: 'P3', question: '会员投入与门店效率投入如何分配？', whyItMatters: '预算固定时的核心取舍。'},
  ],
  assumptions: '试点期间预算不变。',
  evidenceGaps: '门店工时与自然复购待补证。',
  followUp: '候选须说明选择与放弃、资源倾斜及成立条件。',
};

test('真实 Host+Pi：事项主会话开题保存草稿、幂等回读与负例', {timeout: 120_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '事项合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-initiative', apiKey: 'synthetic-initiative-only'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '华东门店增长战略', scopes: [stores]}, 201);
  const fileContent = '合成经营复盘：首购会员 90 天二购率约 9%，成熟门店间差异明显。';
  const uploaded = (await req(`/api/strategy/initiatives/${initiativeId}/files`, 'POST', {operationId: randomUUID(), directory: '010_draw', name: '上期经营复盘.md', contentBase64: Buffer.from(fileContent, 'utf8').toString('base64')}, 201)).file;
  const session = (await req(`/api/strategy/initiatives/${initiativeId}/session`, 'POST', {operationId: randomUUID(), scope: stores}, 201)).session;
  assert.equal(session.scopeKey, scopeKey);
  assert.equal(provider.requests.length, 0, 'create/read/upload never wakes a model');
  const sessionRoute = `/api/strategy/initiatives/${initiativeId}/session?scopeKey=${encodeURIComponent(scopeKey)}`;
  const messageRoute = `/api/strategy/initiatives/${initiativeId}/messages?scopeKey=${encodeURIComponent(scopeKey)}`;
  const detail0 = await req(sessionRoute);
  assert.equal(detail0.session.revision, 1);
  assert.equal(detail0.snapshot, null);

  provider.setResponder(ctx => {
    const step = ctx.recentToolResults.length;
    if (step === 0) return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-files'}}]};
    if (step === 1) return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-read-file', fileId: uploaded.fileId}}]};
    if (step === 2) return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-kickoff', operationId: randomUUID(), kickoffFields, kickoffSources: [{kind: 'file', ref: `010_draw/${uploaded.name}`, title: uploaded.name, fileId: uploaded.fileId, sha256: uploaded.sha256}]}}]};
    return {text: '开题草稿已保存，请核对并锁定。'};
  });
  const requestId = randomUUID();
  const messageInput = {requestId, text: '请基于获准资料开题，形成三个关键战略命题。', expectedRevision: 1};
  await req(messageRoute, 'POST', messageInput, 202);
  const settled = async () => {
    for (let n = 0; n < 500; n++) {
      const d = await req(sessionRoute);
      if (d.session.lastRun?.status && d.session.lastRun.status !== 'accepted') return d;
      await delay(20);
    }
    throw Error('session did not settle');
  };
  let detail = await settled();
  assert.equal(detail.session.lastRun.status, 'completed');
  assert.equal(detail.reports.versions.length, 1);
  const v1 = detail.reports.versions[0];
  assert.equal(v1.generation.kind, 'agent');
  assert.equal(v1.generation.requestId, requestId);
  assert.equal(v1.lock, undefined);
  assert.deepEqual(v1.fields.propositions.map((p: any) => p.id), ['P1', 'P2', 'P3']);
  assert.equal(v1.sources[0].sha256, uploaded.sha256);
  assert.ok(detail.snapshot?.sessionFile);
  const nativeEntries = (await readFile(detail.snapshot.sessionFile, 'utf8')).trim().split('\n').map((line: string) => JSON.parse(line));
  assert.ok(nativeEntries.some((entry: any) => entry.message?.role === 'assistant' && Array.isArray(entry.message.content) && entry.message.content.some((part: any) => part.type === 'toolCall' && part.arguments?.action === 'initiative-save-kickoff')));

  const count = provider.requests.length;
  const replay = await req(messageRoute, 'POST', messageInput, 202);
  assert.equal(replay.replayed, true);
  assert.equal(provider.requests.length, count, 'replaying exact request does not call model');

  let correctionEvidence = '';
  const invalidOperation = randomUUID();
  provider.setResponder(ctx => {
    const step = ctx.recentToolResults.length;
    if (step === 0) return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-kickoff', operationId: invalidOperation, kickoffFields: {...kickoffFields, propositions: kickoffFields.propositions.slice(0, 2)}, kickoffSources: []}}]};
    if (step === 1) {
      correctionEvidence = providerMessageText(ctx.recentToolResults[0]?.content);
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-kickoff', operationId: randomUUID(), kickoffFields}}]};
    }
    return {text: '已按字段定位补足命题，并无来源保存。'};
  });
  await req(messageRoute, 'POST', {requestId: randomUUID(), text: '再试一次开题；如果校验失败，请按工具回包定位修正。', expectedRevision: detail.session.revision}, 202);
  detail = await settled();
  assert.equal(detail.session.lastRun.status, 'completed');
  assert.match(correctionEvidence, /strategy_kickoff_schema_invalid/);
  assert.match(correctionEvidence, /proposition_count/);
  assert.match(correctionEvidence, /fields\.propositions/);
  assert.equal(detail.reports.versions.length, 2, 'invalid attempt writes nothing; the corrected save writes one new version');
  assert.equal(detail.reports.versions.some((version: any) => version.generation.operationId === invalidOperation), false);
  assert.deepEqual(detail.reports.versions[1].sources, []);
  assert.deepEqual(provider.errors, []);
});

test('真实 Host+Pi：冻结配置线路变化后拒绝派发', {timeout: 90_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '配置变化', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-initiative', apiKey: 'synthetic-config-change'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '配置变化事项', scopes: [stores]}, 201);
  const created = (await req(`/api/strategy/initiatives/${initiativeId}/session`, 'POST', {operationId: randomUUID(), scope: stores}, 201)).session;
  const messageRoute = `/api/strategy/initiatives/${initiativeId}/messages?scopeKey=${encodeURIComponent(scopeKey)}`;
  await req('/api/configuration', 'PUT', {id: created.configurationId, name: '配置变化', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:14998/v1', model: 'synthetic-initiative', apiKey: 'synthetic-config-change'});
  const requests = provider.requests.length;
  const denied = await req(messageRoute, 'POST', {requestId: randomUUID(), text: '继续开题。', expectedRevision: 1}, 409);
  assert.equal(denied.code, 'configuration_changed');
  assert.equal(provider.requests.length, requests, 'frozen configuration line change blocks dispatch');
});

test('真实 Host+Pi：事项主会话停止、关闭与重开读回', {timeout: 120_000}, async t => {
  const provider = await startToolProvider();
  const scratch = await mkdtemp(join(os.tmpdir(), 'optracall-initiative-session-'));
  const options = {dataRoot: join(scratch, 'host'), projectsRoot: join(scratch, 'projects')};
  let host = await startTestHost(options);
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '事项生命周期', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-initiative', apiKey: 'synthetic-initiative-lifecycle'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '生命周期事项', scopes: [stores]}, 201);
  await req(`/api/strategy/initiatives/${initiativeId}/session`, 'POST', {operationId: randomUUID(), scope: stores}, 201);
  const sessionRoute = `/api/strategy/initiatives/${initiativeId}/session?scopeKey=${encodeURIComponent(scopeKey)}`;
  const messageRoute = `/api/strategy/initiatives/${initiativeId}/messages?scopeKey=${encodeURIComponent(scopeKey)}`;
  provider.setResponder(() => ({text: '等待补证', hold: true}));
  const requestId = randomUUID();
  await req(messageRoute, 'POST', {requestId, text: '开始开题。', expectedRevision: 1}, 202);
  await provider.waitForRequests(1);
  await req(`/api/strategy/initiatives/${initiativeId}/stop?scopeKey=${encodeURIComponent(scopeKey)}`, 'POST', {expectedRequestId: requestId});
  let detail: any;
  for (let n = 0; n < 300; n++) { detail = await req(sessionRoute); if (detail.session.lastRun?.status === 'cancelled') break; await delay(20); }
  assert.equal(detail.session.lastRun.status, 'cancelled');
  const requests = provider.requests.length;
  await req(`/api/strategy/initiatives/${initiativeId}/close?scopeKey=${encodeURIComponent(scopeKey)}`, 'POST', {});
  detail = await req(sessionRoute);
  assert.equal(provider.requests.length, requests, 'close/read does not call model');
  assert.ok(detail.snapshot?.sessionFile);
  const sessionFile = detail.snapshot.sessionFile;
  await host.close();
  host = await startTestHost(options);
  const reopened = await req(sessionRoute);
  assert.equal(reopened.session.lastRun.status, 'cancelled');
  assert.ok(reopened.snapshot, 'native history reads back after restart');
  assert.equal(reopened.snapshot.sessionFile, sessionFile);
});