import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as automaticClient from '../src/host/ui/automatic-verification-client.ts';
import {
  AutomaticVerificationRequestError,
  automaticSettingsError, readAutomaticSettings,
  listAutomaticChains, mergeAutomaticChains, readAutomaticChain, readAutomaticCapabilities,
  readAutomaticStatus,
} from '../src/host/ui/automatic-verification-client.ts';
import type { AutomaticChain, AutomaticSettings, AutomaticSettingsInput } from '../src/host/automatic-verification-types.ts';

const owner = { projectId: 'project-a', taskId: 'task-a' };
const chainId = 'a'.repeat(64);
const input: AutomaticSettingsInput = { enabled: true, question: '核对报告及相关过程', dataFiles: ['020_clean/source.csv'], reportPath: '060_reports/new-report.md', processFiles: ['020_clean/calc.py'], maxAuthorTurns: 2 };
const settings: AutomaticSettings = { ...owner, ...input, formatVersion: 1, revision: 3, dataFiles: input.dataFiles!, processFiles: input.processFiles!, maxAuthorTurns: 2 };
const native = { sessionFile: '/private/native.jsonl', sessionId: 'session-a', bytes: 20, sha256: 'b'.repeat(64) };
const configuration = { id: 'configuration-a', revision: 1, provider: 'synthetic', model: 'synthetic-model' };
const chain: AutomaticChain = { ...owner, formatVersion: 1, chainId, revision: 1, triggerFingerprint: chainId, requestId: 'request-a', requestFingerprint: 'c'.repeat(64), reportSha256: 'd'.repeat(64), settingsSnapshot: settings, native, configuration, verificationConfiguration: configuration, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', state: 'running', phase: 'cold', reason: 'none', authorAccepted: 0, materials: [], versions: [], steps: [] };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

test('AV01 disabled settings need no report, while enabled selection rejects source/author overlap and path traversal', () => {
  assert.equal(automaticSettingsError({ enabled: false }), undefined);
  assert.equal(automaticSettingsError(input), undefined);
  assert.match(automaticSettingsError({ ...input, reportPath: '060_reports/../old.md' }) ?? '', /路径/);
  assert.match(automaticSettingsError({ ...input, processFiles: input.dataFiles }) ?? '', /源数据.*作者/);
  assert.match(automaticSettingsError({ ...input, caseId: 'case-a', caseRevision: 2 }) ?? '', /事前/);
  assert.match(automaticSettingsError({ ...input, maxAuthorTurns: 4 as 1 }) ?? '', /1.*2.*3/);
  assert.match(automaticSettingsError({ ...input, question: '问'.repeat(4001) }) ?? '', /4000/);
});

test('AV01 settings, history and capabilities observation only use GET', async t => {
  const calls: { url: string; method: string }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), method: init.method ?? 'GET' });
    return response(String(url).endsWith('/settings') ? { settings } : String(url).endsWith('/capabilities') ? { supported: true } : String(url).endsWith('/status') ? { busy: false } : String(url).endsWith('/chains') ? { chains: [chain] } : { chain });
  });
  assert.equal((await readAutomaticSettings(owner.projectId, owner.taskId)).revision, 3);
  assert.equal((await listAutomaticChains(owner.projectId, owner.taskId))[0]?.chainId, chainId);
  assert.equal((await readAutomaticChain(owner.projectId, owner.taskId, chainId)).settingsSnapshot.reportPath, input.reportPath);
  assert.equal((await readAutomaticCapabilities(owner.projectId, owner.taskId)).supported, true);
  assert.equal((await readAutomaticStatus(owner.projectId, owner.taskId)).busy, false);
  assert.ok(calls.every(call => call.method === 'GET'));
  assert.ok(calls.every(call => call.url.startsWith('/api/projects/project-a/tasks/task-a/automatic-verification/')));
});

test('AV10 another owner or chain must never be projected into this task', async t => {
  t.mock.method(globalThis, 'fetch', async (url: string) => response(String(url).endsWith('/settings') ? { settings: { ...settings, taskId: 'task-b' } } : { chain: { ...chain, chainId: 'd'.repeat(64) } }));
  await assert.rejects(readAutomaticSettings(owner.projectId, owner.taskId), /归属/);
  await assert.rejects(readAutomaticChain(owner.projectId, owner.taskId, chainId), /归属|编号/);
});

test('AV10 nested settings and admission observations cannot borrow another task owner', async t => {
  t.mock.method(globalThis, 'fetch', async (url: string) => response(String(url).endsWith('/status')
    ? { busy: false, observation: { projectId: 'project-b', taskId: owner.taskId } }
    : { chain: { ...chain, settingsSnapshot: { ...settings, taskId: 'task-b' } } }));
  await assert.rejects(readAutomaticChain(owner.projectId, owner.taskId, chainId), /归属/);
  await assert.rejects(readAutomaticStatus(owner.projectId, owner.taskId), /归属/);
});

test('AV07 historical cleanup acknowledgement does not rewrite UNKNOWN or treat a stop reason as proof', async t => {
  const unknown = { ...chain, state: 'unknown' as const, phase: 'ended' as const, reason: 'request_unknown' as const, cleanup: { state: 'confirmed' as const, retryable: false } };
  const methods: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => { methods.push(init.method ?? 'GET'); return response({ chain: unknown }); });
  assert.equal((await readAutomaticChain(owner.projectId, owner.taskId, chainId)).state, 'unknown');
  assert.deepEqual(methods, ['GET']);
  assert.equal(automaticClient.automaticCleanupConfirmed(unknown), true);
  assert.equal(automaticClient.automaticChainLabel(unknown), '结果待确认');
  const unconfirmed = { ...unknown, reason: 'user_stopped' as const, cleanup: { state: 'unknown' as const, retryable: true } };
  assert.equal(automaticClient.automaticCleanupConfirmed(unconfirmed), false);
  assert.equal(automaticClient.automaticChainLabel({ ...unconfirmed, state: 'cancelled' }), '停止结果待确认');
});

test('AV10 late observations cannot revive a stopped chain or erase an earlier chain snapshot', () => {
  const stopped: AutomaticChain = { ...chain, revision: 3, state: 'cancelled', phase: 'ended', reason: 'user_stopped' };
  const next: AutomaticChain = { ...chain, chainId: 'e'.repeat(64), createdAt: '2026-11-01T01:00:00Z', settingsSnapshot: { ...settings, reportPath: '060_reports/next-report.md' } };
  const values = mergeAutomaticChains([stopped, next], [chain]);
  assert.equal(values.length, 2);
  assert.equal(values.find(value => value.chainId === chainId)?.state, 'cancelled');
  assert.equal(values.find(value => value.chainId === chainId)?.settingsSnapshot.reportPath, input.reportPath);
  assert.equal(values.find(value => value.chainId === next.chainId)?.settingsSnapshot.reportPath, '060_reports/next-report.md');
});

const fixedReport = (content: Uint8Array = Buffer.from('历史固定稿：1,900元。\n'), version = 2) => ({
  version, relativePath: `060_reports/draft-${version}.md`, sha256: createHash('sha256').update(content).digest('hex'),
  bytes: content.byteLength, contentBase64: Buffer.from(content).toString('base64'),
  textStatus: 'utf8' as const, text: Buffer.from(content).toString('utf8'),
});

test('AV09 each fixed report is read by exact owner chain and version using only GET; download keeps original bytes', async t => {
  assert.equal(typeof automaticClient.readAutomaticReport, 'function');
  const report = fixedReport(), calls: { url: string; method: string }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => { calls.push({ url: String(url), method: init.method ?? 'GET' }); return response({ report }); });
  const value = await automaticClient.readAutomaticReport(owner.projectId, owner.taskId, chainId, report);
  assert.equal(value.text, report.text);
  assert.deepEqual(calls, [{ url: `/api/projects/project-a/tasks/task-a/automatic-verification/chains/${chainId}/reports/2`, method: 'GET' }]);
  assert.deepEqual(new Uint8Array(await automaticClient.automaticReportBlob(value).arrayBuffer()), Uint8Array.from(Buffer.from(report.contentBase64, 'base64')));
  assert.equal(calls.length, 1, 'preview and download use the read fixed bytes without another dispatch');
});

test('AV09 fixed-text preview states its exact UTF-16 range rather than presenting a fragment as full text', async t => {
  assert.equal(typeof automaticClient.readAutomaticReport, 'function');
  const report = fixedReport(Buffer.from('历史😀'.repeat(5000)));
  t.mock.method(globalThis, 'fetch', async () => response({ report }));
  const value = await automaticClient.readAutomaticReport(owner.projectId, owner.taskId, chainId, report);
  assert.deepEqual(automaticClient.automaticReportPreview(value), { text: report.text.slice(0, 16000), start: 0, end: 16000, totalLength: report.text.length, complete: false });
  const short = fixedReport();
  assert.equal(automaticClient.automaticReportPreview(short)?.complete, true);
});

test('AV09 binary fixed reports have no text preview while original-byte download remains available', async t => {
  assert.equal(typeof automaticClient.readAutomaticReport, 'function');
  const bytes = Uint8Array.of(0xff, 0x00, 0xc0, 0x80), { text: _text, ...baseReport } = fixedReport(bytes);
  const report = { ...baseReport, textStatus: 'not-utf8' as const };
  t.mock.method(globalThis, 'fetch', async () => response({ report }));
  const value = await automaticClient.readAutomaticReport(owner.projectId, owner.taskId, chainId, report);
  assert.equal(value.text, undefined);
  assert.equal(automaticClient.automaticReportPreview(value), undefined);
  assert.deepEqual(new Uint8Array(await automaticClient.automaticReportBlob(value).arrayBuffer()), bytes);
});

test('AV09 a mismatched report version path hash or byte body cannot replace an already read historical draft', async t => {
  assert.equal(typeof automaticClient.readAutomaticReport, 'function');
  const report = fixedReport(), calls: string[] = []; let reply: unknown = report;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => { calls.push(init.method ?? 'GET'); return response({ report: reply }); });
  const old = await automaticClient.readAutomaticReport(owner.projectId, owner.taskId, chainId, report), before = structuredClone(old);
  for (const patch of [{ version: 1 }, { relativePath: '060_reports/current.md' }, { sha256: 'f'.repeat(64) }, { contentBase64: Buffer.from('替换正文').toString('base64') }, { text: '与原始字节不一致的正文' }]) {
    reply = { ...report, ...patch };
    await assert.rejects(automaticClient.readAutomaticReport(owner.projectId, owner.taskId, chainId, report), AutomaticVerificationRequestError);
    assert.deepEqual(old, before, 'a failed read leaves the caller’s prior fixed result unchanged');
  }
  assert.ok(calls.every(method => method === 'GET'));
});
