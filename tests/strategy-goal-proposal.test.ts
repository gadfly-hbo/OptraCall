import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { providerMessageText, startToolProvider } from './fixtures/tool-provider.ts';

test('project-free strategy discussions discover authorized scopes, correct proposals and preserve original goals', { timeout: 60_000 }, async t => {
  const host = await startTestHost();
  const provider = await startToolProvider();
  t.after(async () => { await host.close(); await provider.close(); });
  async function api(route: string, method = 'GET', body?: unknown, status = 200) {
    const response = await host.request(route, method, body);
    assert.equal(response.status, status, await response.clone().text());
    return response.json();
  }
  await api('/api/configuration', 'PUT', { name: '本地合成工具模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic', apiKey: 'synthetic-only' });
  const enterprise = await api('/api/studio/enterprises', 'POST', { name: '合成会员企业' }, 201);
  const { discussion } = await api('/api/strategy/discussions', 'POST', { operationId: randomUUID(), title: '独立战略讨论' }, 201);
  assert.equal(discussion.projectId, undefined);
  assert.equal(discussion.goal, undefined);
  const base = '/api/strategy/discussions/' + discussion.id;
  const index = path.join(host.dataRoot, 'strategy-goals', 'index.json');
  async function storeBytes() {
    try { return await readFile(index); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  async function runTool(args: Record<string, unknown>, text: string, route = base) {
    const before = await api(route);
    let toolText: string | undefined;
    provider.setResponder(ctx => {
      if (!ctx.recentToolResults.length) return { calls: [{ name: 'strategy_goals', arguments: args }] };
      toolText = providerMessageText(ctx.recentToolResults.at(-1)?.content);
      return { text: '已核对本次工具回执。' };
    });
    const requestId = randomUUID();
    await api(route + '/messages', 'POST', { requestId, expectedRevision: before.discussion.revision, text }, 202);
    const deadline = Date.now() + 20_000;
    for (;;) {
      const detail = await api(route);
      if (!detail.busy && detail.discussion.lastRun?.id === requestId && detail.discussion.lastRun.status === 'completed') {
        assert.equal(typeof toolText, 'string');
        const records = (await readFile(detail.snapshot.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
        const result = records.filter(row => row.message?.role === 'toolResult' && row.message.toolName === 'strategy_goals').at(-1);
        assert.ok(result);
        return { detail, records, text: toolText!, error: result.message.isError };
      }
      assert.ok(Date.now() < deadline, 'Strategy turn did not finish');
      await delay(30);
    }
  }

  const before = await storeBytes();
  const malformed = await runTool({ action: 'propose-goal', draft: { title: '合成年度目标', scope: '会员业务范围', version: 'v0.4' } }, '请根据原讨论形成目标候选。');
  assert.equal(malformed.error, true);
  assert.equal(malformed.detail.goals.length, 0);
  assert.deepEqual(await storeBytes(), before);
  for (const field of ['scope', 'outcome', 'perspective', 'measurement', 'baseline', 'responsible']) {
    assert.ok(malformed.text.includes(field), 'Missing field diagnostic ' + field + ' in ' + malformed.text);
  }

  const firstPrompt = provider.requests[0].body.messages?.filter(message => message.role === 'user').map(message => providerMessageText(message.content)).join('\n');
  assert.ok(firstPrompt?.includes(enterprise.id), 'The Host supplies the exact enterprise identity on the first turn');
  const tool = provider.requests[0].body.tools?.find(tool => tool.function?.name === 'strategy_goals');
  assert.ok(tool?.function?.parameters);
  const toolSchema = JSON.stringify(tool.function.parameters);
  for (const field of ['title', 'outcome', 'perspective', 'measurement', 'baseline', 'responsible']) {
    assert.ok(toolSchema.includes('"' + field + '":'), 'The model must see the schema for ' + field);
  }

  const discovery = await runTool({ action: 'read-goals' }, '请核对本轮可以选择的目标范围。');
  const { candidates, goalScopes } = JSON.parse(discovery.text);
  assert.deepEqual(candidates, []);
  assert.ok(goalScopes, 'read-goals must expose the Host scope choices');
  assert.equal(goalScopes.bound, undefined);
  const scope = goalScopes.choices.find((item: { id: string }) => item.id === enterprise.id);
  assert.equal(scope?.kind, 'enterprise');
  assert.equal(scope?.name, enterprise.name);

  const draft = {
    title: '改善会员留存', outcome: '找出流失原因并核对干预效果', perspective: 'profit', responsible: '会员负责人',
    baseline: { state: 'pending', description: '等待原始数据核对基线' },
    measurement: { kind: 'deliverable', criterion: '形成经业务核对的两组观察记录' },
    strategies: ['记录首轮观察后再决定是否调整'], necessaryConditions: ['口径可复核'],
  };
  const ambiguous = await runTool({ action: 'propose-goal', draft }, '提议一个目标，归属尚未确认。');
  assert.equal(ambiguous.error, true);
  assert.match(ambiguous.text, /draft[./]scope/);
  assert.deepEqual(await storeBytes(), before, 'A single enterprise in the directory does not establish this discussion’s scope');

  const valid = await runTool({ action: 'propose-goal', draft: { ...draft, scope } }, '本次目标归合成会员企业，请保存候选。');
  assert.equal(valid.error, false, valid.text);
  assert.equal(valid.detail.goals.length, 1);
  const proposal = JSON.parse(valid.text);
  assert.equal(proposal.claim, 'candidate-not-adopted');
  const { goal } = await api('/api/strategy/goals/' + proposal.goal.goalId);
  assert.equal(goal.adoptedVersion, null);
  assert.equal(goal.versions.length, 1);
  const saved = goal.versions[0];
  assert.equal(saved.status, 'candidate');
  assert.deepEqual(saved.scope, scope);
  for (const [key, value] of Object.entries(draft)) assert.deepEqual(saved[key], value, key);
  assert.equal(saved.source.authority, 'strategy-discussion');
  assert.equal(saved.source.id, discussion.id);
  const entry = valid.records.find(row => row.id === saved.source.version);
  assert.ok(entry?.message?.content.some((part: { type: string; arguments?: { draft?: { title?: string } } }) => part.type === 'toolCall' && part.arguments?.draft?.title === draft.title));
  const bytesWithGoal = await storeBytes();
  assert.ok(bytesWithGoal);

  const rejected = await runTool({ action: 'propose-goal', draft: { ...draft, scope: { ...scope, id: randomUUID() } } }, '继续核对候选的范围。');
  assert.equal(rejected.error, true);
  assert.match(rejected.text, /draft[./]scope/);
  assert.equal(rejected.detail.goals.length, 1);
  assert.deepEqual(await storeBytes(), bytesWithGoal, 'Failure must not change a goal, its versions, or operation receipts');
  const absent = await runTool({ action: 'propose-goal' }, '核对空提案。');
  assert.equal(absent.error, true);
  assert.match(absent.text, /\bdraft\b/);
  assert.deepEqual(await storeBytes(), bytesWithGoal);
  const revision = { action: 'propose-goal', goalId: goal.id, expectedVersion: 1, draft: { ...draft, title: '核对后修订的会员候选' } };
  const other = await api('/api/strategy/discussions', 'POST', { operationId: randomUUID(), title: '另一独立讨论' }, 201);
  const unrelated = await runTool(revision, '核对外部给定的目标编号。', '/api/strategy/discussions/' + other.discussion.id);
  assert.equal(unrelated.error, true, unrelated.text);
  assert.deepEqual(await storeBytes(), bytesWithGoal, 'An unrelated discussion cannot revise the candidate using just its identifier');

  const revised = await runTool(revision, '请沿用原企业范围修订刚才保存的候选。');
  assert.equal(revised.error, false, revised.text);
  const versions = (await api('/api/strategy/goals/' + goal.id)).goal.versions;
  assert.equal(versions.length, 2);
  assert.deepEqual(versions[0], saved);
  assert.deepEqual(versions[1].scope, saved.scope);
  assert.equal(versions[1].title, revision.draft.title);
  await t.test('an organizational discussion uses its single registered enterprise', async () => {
    const { discussion } = await api('/api/strategy/discussions', 'POST', {
      operationId: randomUUID(), title: '已有组织用途', usageContext: { kind: 'organization', background: '本企业的经营目标' },
    }, 201);
    const route = '/api/strategy/discussions/' + discussion.id;
    const known = await runTool({ action: 'read-goals' }, '核对企业目标范围。', route);
    assert.ok(JSON.parse(known.text).goalScopes.choices.some((choice: { id: string; name: string }) => choice.id === scope.id && choice.name === scope.name));
    const proposed = await runTool({ action: 'propose-goal', draft }, '按当前的企业范围保存。', route);
    assert.equal(proposed.error, false, proposed.text);
    assert.deepEqual(proposed.detail.goals[0].scope, scope);
  });

  await t.test('a department can use its earlier declaration without inventing an upper enterprise', async () => {
    const { discussion } = await api('/api/strategy/discussions', 'POST', {
      operationId: randomUUID(), title: '部门用途', usageContext: { kind: 'department', background: '部门承接的经营工作' },
    }, 201);
    const route = '/api/strategy/discussions/' + discussion.id;
    const declared = { kind: 'department', id: '会员经营部', name: '会员经营部' };
    const read = await runTool({ action: 'read-goals' }, '这次目标归会员经营部，上层组织尚未确定。', route);
    const { goalScopes } = JSON.parse(read.text);
    assert.equal(goalScopes.bound, undefined);
    const previous = await storeBytes();
    const missing = await runTool({ action: 'propose-goal', draft }, '请按前面声明的部门保存。', route);
    assert.equal(missing.error, true, missing.text);
    assert.match(missing.text, /draft[./]scope/);
    assert.equal(missing.detail.goals.length, 0);
    assert.deepEqual(await storeBytes(), previous, 'Department context alone cannot select a personal or enterprise scope');
    const proposed = await runTool({ action: 'propose-goal', draft: { ...draft, scope: declared } }, '现在按已声明的范围保存候选。', route);
    assert.equal(proposed.error, false, proposed.text);
    assert.deepEqual(proposed.detail.goals[0].scope, declared);
  });
  assert.deepEqual(provider.errors, []);
});
