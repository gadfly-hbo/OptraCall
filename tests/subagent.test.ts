import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, symlink, link } from 'node:fs/promises';
import path from 'node:path';
import { createSubagentTool, discoverSubagentRoles, type SubagentResult, type SubagentRole } from '../src/agent/subagent.ts';

async function fixture(t: TestContext) {
  const evidence = path.resolve('.local/task-agent-capabilities/roles'); await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(path.join(evidence, 'discovery-'));
  const skill = async (name: string) => {
    const baseDir = path.join(root, name), filePath = path.join(baseDir, 'SKILL.md'); await mkdir(path.join(baseDir, 'agents'), { recursive: true });
    await writeFile(filePath, `---\nname: ${name}\ndescription: Synthetic discovery fixture.\n---\nSynthetic skill body.\n`);
    const value: Parameters<typeof discoverSubagentRoles>[0][number] = { name, description: 'Synthetic discovery fixture.', baseDir, filePath, disableModelInvocation: false, sourceInfo: { path: baseDir, source: 'synthetic', scope: 'user', origin: 'top-level' } };
    return value;
  };
  const role = (baseDir: string, filename: string, name: string, metadata = '') => writeFile(path.join(baseDir, 'agents', filename), `---\nname: ${name}\ndescription: Synthetic role.\n${metadata}---\nROLE_${name}\n`);
  return { root, skill, role };
}
const role = (name: string): SubagentRole => ({ name, description: 'Synthetic role.', prompt: 'Synthetic instructions.', baseDir: '/synthetic' });
type ToolReply = { isError?: boolean; details: { mode: string; results: SubagentResult[] } };
const invoke = (tool: ReturnType<typeof createSubagentTool>, parameters: Record<string, unknown>, signal?: AbortSignal): Promise<ToolReply> => Reflect.apply(tool.execute, undefined, ['synthetic-call', parameters, signal]);

test('skill roles retain namespaces, accept both tools spellings and reject unsafe file aliases', async t => {
  const f = await fixture(t), first = await f.skill('first'), second = await f.skill('second');
  await f.role(first.baseDir, 'reviewer.md', 'reviewer', 'tools: read, grep\n');
  await f.role(second.baseDir, 'reviewer.md', 'reviewer', 'tools: [read, bash]\n');
  const outside = path.join(f.root, 'outside.md'); await writeFile(outside, '---\nname: outside\ndescription: Must not escape.\n---\nOUTSIDE\n');
  await symlink(outside, path.join(first.baseDir, 'agents', 'escape.md'));
  await link(outside, path.join(first.baseDir, 'agents', 'hardlink.md'));
  const found = discoverSubagentRoles([first, second]);
  assert.deepEqual(found.map(value => ({ name: value.name, tools: value.tools })), [{ name: 'first/reviewer', tools: ['read', 'grep'] }, { name: 'second/reviewer', tools: ['read', 'bash'] }]);
});

test('duplicate and privilege-changing role definitions cannot replace another discovered role', async t => {
  const f = await fixture(t), skill = await f.skill('fixture');
  await f.role(skill.baseDir, 'good.md', 'good');
  await f.role(skill.baseDir, 'duplicate-a.md', 'duplicate'); await f.role(skill.baseDir, 'duplicate-b.md', 'duplicate');
  await f.role(skill.baseDir, 'model.md', 'model', 'model: external-provider/model\n');
  await f.role(skill.baseDir, 'cwd.md', 'cwd', 'cwd: /private\n');
  await f.role(skill.baseDir, 'agentdir.md', 'agentdir', 'agentDir: /private\n');
  await f.role(skill.baseDir, 'bad-tools.md', 'badtools', 'tools: [read, {provider: escape}]\n');
  await f.role(skill.baseDir, 'invalid.md', '../outside');
  assert.deepEqual(discoverSubagentRoles([skill]).map(value => value.name), ['fixture/good']);
});

test('a parallel or chained request validates every role before starting any child', async () => {
  const started: string[] = [], tool = createSubagentTool([role('fixture/worker')], async selected => { started.push(selected.name); return { agent: selected.name, outcome: 'completed', text: 'done' }; });
  for (const mode of ['tasks', 'chain']) await assert.rejects(invoke(tool, { [mode]: [{ agent: 'fixture/worker', task: 'must not start' }, { agent: 'fixture/missing', task: 'invalid role' }] }), /subagent_role_unavailable/);
  assert.deepEqual(started, []);
  for (const parameters of [{}, { agent: 'fixture/worker' }, { task: 'orphan' }, { agent: 'fixture/worker', task: 'one', tasks: [{ agent: 'fixture/worker', task: 'two' }] }]) await assert.rejects(invoke(tool, parameters), /subagent_invalid_mode/);
});

test('parallel failures preserve independent results and keep the parent waiting for the surviving branch', async () => {
  let finish: ((value: SubagentResult) => void) | undefined;
  const survivor = new Promise<SubagentResult>(resolve => { finish = resolve; });
  const tool = createSubagentTool([role('fixture/fail'), role('fixture/worker')], async selected => { if (selected.name.endsWith('/fail')) throw new Error('synthetic failure'); return survivor; });
  let settled = false;
  const pending = invoke(tool, { tasks: [{ agent: 'fixture/fail', task: 'fail' }, { agent: 'fixture/worker', task: 'finish later' }] }).then(value => { settled = true; return value; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false, 'one failure cannot release the parent while another child is still running');
  finish!({ agent: 'fixture/worker', outcome: 'completed', text: 'surviving result' });
  const result = await pending;
  assert.equal(result.isError, true); assert.deepEqual(result.details.results.map((value: SubagentResult) => value.outcome), ['failed', 'completed']);
  assert.equal(result.details.results[1].text, 'surviving result');
});

test('chain passes prior output literally and stops on failure or pre-cancellation', async () => {
  const calls: string[] = [], roles = [role('fixture/first'), role('fixture/second'), role('fixture/third')];
  const tool = createSubagentTool(roles, async (selected, task) => { calls.push(task); return { agent: selected.name, outcome: selected.name.endsWith('/second') ? 'failed' : 'completed', text: '$& {previous} first-result' }; });
  const result = await invoke(tool, { chain: roles.map((value, index) => ({ agent: value.name, task: index === 0 ? 'first' : 'check {previous}' })) });
  assert.deepEqual(calls, ['first', 'check $& {previous} first-result']); assert.equal(result.details.results.length, 2); assert.equal(result.isError, true);
  calls.length = 0; const controller = new AbortController(); controller.abort();
  const cancelled = await invoke(tool, { agent: 'fixture/first', task: 'must not start' }, controller.signal);
  assert.deepEqual(calls, []); assert.equal(cancelled.details.results[0].outcome, 'cancelled'); assert.equal(cancelled.isError, true);
});
