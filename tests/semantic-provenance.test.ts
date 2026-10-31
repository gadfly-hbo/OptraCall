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
