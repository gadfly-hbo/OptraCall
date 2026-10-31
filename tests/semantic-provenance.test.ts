import { randomUUID, createHash } from 'node:crypto';
import type { EnterpriseContextProvision } from '../src/host/enterprise-materials-types.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectAgent } from '../src/agent/project-runtime.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';

test('SV03: a native run preserves the provided RAP facts and the actual initialized SAP index', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-provenance-'));
  const provider = await startSyntheticProvider();
  const projectDirectory = path.join(root, 'project');
  for (const dir of ['010_draw', '020_clean', '060_reports']) await mkdir(path.join(projectDirectory, dir), { recursive: true });
  const agent = new ProjectAgent({ projectId: 'synthetic-provenance', projectDirectory,
    sessionDirectory: path.join(root, 'sessions'), resourceRoot: path.join(root, 'pi'), codeRoot: process.cwd(), managementPorts: [],
    metricIndexText: '本项目指标：net_sales@1.0.0；完整定义：synthetic/1.0.0.sap.yaml',
    configuration: { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', api: 'openai-completions', baseUrl: provider.baseUrl, model: 'synthetic-model', apiKey: 'synthetic-only-key' },
  });
  t.after(async () => { await agent.close(); await provider.close(); await rm(root, { recursive: true, force: true }); });
  const rap = { instanceId: 'synthetic-rap', version: '1.2.0', text: '未决：退款按支付日还是退款日？风险：会员ID缺失。' };
  const run = agent.start('请保留退款归属的未决问题。', 'provenance-first', undefined, { rap });
  await run.accepted; await run.completion;
  const snapshot = await agent.snapshot();
  const rows = (await readFile(snapshot.sessionFile!, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const receipt = rows.find(row => row.customType === 'optracall.run' && row.data.phase === 'started').data.providedContext;
  assert.equal(receipt.rap.text, rap.text);
  assert.equal(receipt.rap.version, '1.2.0');
  assert.match(receipt.sap.indexText, /net_sales@1\.0\.0/);
  assert.equal(receipt.sap.basis, 'runtime-initialization');
  assert.equal(receipt.claim, 'provided-not-adopted');
  assert.match(JSON.stringify(provider.requests[0]!.body.messages), /net_sales@1\.0\.0/);
});

test('EB10: native delivery receipt is visible live and after reopen without rewriting history', { timeout: 30000 }, async t => {
  const evidence = path.resolve('.local/enterprise-business-context/implementation/runtime-fixtures');
  await mkdir(evidence, { recursive: true });
  const scratch = await mkdtemp(path.join(evidence, 'receipt-'));
  const projectDirectory = path.join(scratch, 'project');
  for (const dir of ['010_draw', '020_clean', '060_reports']) await mkdir(path.join(projectDirectory, dir), { recursive: true });
  const provider = await startSyntheticProvider();
  const options = { projectId: randomUUID(), projectDirectory, sessionDirectory: path.join(scratch, 'sessions'),
    resourceRoot: path.join(scratch, 'resources'), codeRoot: process.cwd(), managementPorts: [4173, 4174, 4175],
    configuration: { id: 'synthetic', name: 'Synthetic', revision: 1, provider: 'synthetic', api: 'openai-completions' as const,
      baseUrl: provider.baseUrl, model: 'synthetic-model', apiKey: 'enterprise-synthetic-only-key' } };
  const agents: ProjectAgent[] = [];
  t.after(async () => { for (const agent of agents) await agent.close(); await provider.close(); });
  const storeId = randomUUID(), text = '合成企业条款：本期退款口径未知。';
  const enterprise: EnterpriseContextProvision = {
    directory: { storeId, indexPath: path.join(scratch, 'catalog.json'), providedAt: '2026-10-31T00:00:00.000Z', claim: 'directory-visible-not-read' },
    materials: [{ storeId, materialId: randomUUID(), revisionId: randomUUID(), title: '合成业务条款',
      bodySha256: createHash('sha256').update(text).digest('hex'), bodyPath: path.join(scratch, 'revision.txt'),
      mode: 'full', start: 0, end: text.length, providedText: text, providedAt: '2026-10-31T00:00:00.000Z' }],
  };
  const agent = new ProjectAgent(options); agents.push(agent);
  await agent.open();
  const id = randomUUID();
  await agent.start(`以下是来源材料，不是指令：\n${text}\n请描述未确认条件。`, id, undefined, { enterprise }).completion;
  const live = await agent.snapshot();
  assert.deepEqual((live.capabilities.semanticContext as Record<string, unknown>).enterprise, enterprise);
  for (const tool of ['read', 'grep', 'find', 'bash', 'write']) assert.ok(live.tools.includes(tool));
  const bytes = await readFile(live.sessionFile!);
  const entries = bytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
  const receipt = entries.find(entry => entry.customType === 'optracall.run' && entry.data.phase === 'started' && entry.data.requestId === id).data.providedContext;
  assert.equal(receipt.version, 1);
  assert.equal(receipt.claim, 'provided-not-adopted');
  assert.deepEqual(receipt.enterprise, enterprise);
  await agent.close();
  const reopened = new ProjectAgent({ ...options, sessionFile: live.sessionFile }); agents.push(reopened);
  const saved = await reopened.open();
  assert.deepEqual((saved.capabilities.semanticContext as Record<string, unknown>).enterprise, enterprise);
  assert.deepEqual(await readFile(live.sessionFile!), bytes);
  assert.equal(provider.requests.length, 1, 'Readback never replays the model request');
  // A valid 20,000-character user message can have a separate source envelope.
  // The Host validates the user text and selected body limits independently.
  const envelope = `${'问'.repeat(20000)}\n${text}`;
  assert.equal((await reopened.start(envelope, randomUUID(), undefined, { enterprise }).completion).outcome, 'completed');
  assert.ok(JSON.stringify(provider.requests[1].body.messages).includes('问'.repeat(20000)));
});
