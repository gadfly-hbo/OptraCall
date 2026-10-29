import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectAgent } from '../src/agent/project-runtime.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';
import { requirementSessionDirectory, requirementWorkspace } from '../extensions/business-plugins/requirements-elaboration/session/workspace.ts';
import { buildGenerationPrompt, parseModelJson, normalizeElicit } from '../extensions/business-plugins/requirements-elaboration/session/prompts.ts';
import { sampleInstance } from './fixtures/requirement-sample.ts';

const elicitJson = '```json\n' + JSON.stringify({
  clarifications: [
    { category: '指标口径', priority: 'must_confirm', question: '复购是否剔除退款单？', rationale: '影响分子' },
    { category: '对象/人群', priority: 'must_confirm', question: '分母只算大促首购会员吗？', rationale: '人群口径' },
  ],
  facts: ['双11复购率环比下滑'],
  hypotheses: [{ statement: '高额满减券吸引羊毛党', evidence: '券核销上升', validationCondition: '券核销用户复购率更低' }],
}) + '\n```';

async function fixture(t: TestContext) {
  const provider = await startSyntheticProvider();
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'optracall-requirement-session-'));
  const instanceDirectory = path.join(scratch, 'req-test-001');
  await mkdir(instanceDirectory, { recursive: true });
  const agents: ProjectAgent[] = [];
  const create = () => {
    const agent = new ProjectAgent({
      projectId: 'requirement:req-test-001',
      workspace: requirementWorkspace(instanceDirectory),
      sessionDirectory: requirementSessionDirectory(instanceDirectory),
      resourceRoot: path.join(scratch, 'resources'),
      codeRoot: process.cwd(),
      managementPorts: [4173, 4174, 4175],
      configuration: { id: 'synthetic', name: 'Synthetic', revision: 1, provider: 'synthetic', api: 'openai-completions', baseUrl: provider.baseUrl, model: 'synthetic-model', apiKey: 'synthetic-only-key' },
    });
    agents.push(agent);
    return agent;
  };
  t.after(async () => { for (const agent of agents) await agent.close(); await provider.close(); await rm(scratch, { recursive: true, force: true }); });
  return { provider, create, instanceDirectory };
}

test('RE-03: a plugin workspace session has no data tools and carries the requirement system prompt', async t => {
  const f = await fixture(t), agent = f.create();
  const snapshot = await agent.open();
  assert.deepEqual(snapshot.tools, [], 'requirement sessions must not carry data or shell tools');
  const run = agent.start(buildGenerationPrompt('elicit', sampleInstance()), 'prompt-check');
  await run.completion;
  const request = JSON.stringify(f.provider.requests.at(-1)!.body.messages);
  assert.match(request, /需求梳理助手/);
  assert.match(request, /没有数据访问工具/);
  assert.doesNotMatch(request, /010_draw/, 'plugin sessions must not inherit project directory conventions');
});

test('RE-03: elicit generation returns parseable structured JSON end to end', async t => {
  const f = await fixture(t), agent = f.create();
  f.provider.setChunks([elicitJson]);
  await agent.open();
  const result = await agent.start(buildGenerationPrompt('elicit', sampleInstance()), 'elicit-run').completion;
  assert.equal(result.outcome, 'completed');
  const proposal = normalizeElicit(parseModelJson(result.text), { ...sampleInstance(), clarifications: [], hypotheses: [] });
  assert.equal(proposal.clarifications.length, 2);
  assert.equal(proposal.hypotheses[0]!.id, 'hyp-1');
  assert.equal(proposal.hypotheses[0]!.status, 'proposed');
});

test('RE-03: the session persists its native JSONL inside the requirement instance directory', async t => {
  const f = await fixture(t), agent = f.create();
  f.provider.setChunks([elicitJson]);
  await agent.open();
  const result = await agent.start(buildGenerationPrompt('elicit', sampleInstance()), 'persist-run').completion;
  assert.equal(result.outcome, 'completed');
  const sessions = await readdir(requirementSessionDirectory(f.instanceDirectory));
  assert.equal(sessions.filter(name => name.endsWith('.jsonl')).length, 1);
});

test('RE-03: stop settles the plugin session as cancelled exactly once', async t => {
  const f = await fixture(t), agent = f.create();
  f.provider.setMode('slow');
  await agent.open();
  const events: any[] = []; agent.subscribe(event => events.push(event));
  const running = agent.start(buildGenerationPrompt('elicit', sampleInstance()), 'cancel-run');
  await f.provider.waitForRequests(1);
  await agent.stop();
  assert.equal((await running.completion).outcome, 'cancelled');
  assert.equal(events.filter(event => event.type === 'run.settled' && event.requestId === 'cancel-run').length, 1);
});
