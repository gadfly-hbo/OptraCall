import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectAgent, type ProjectAgentOptions } from '../src/agent/project-runtime.ts';

type RequestRecord = { body: any; authorization?: string; system: string };
const contentText = (content: any): string => typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part.text ?? '').join('') : '';
const names = (body: any): string[] => (body.tools ?? []).map((tool: any) => tool.function?.name ?? tool.name);
const userText = (body: any): string => contentText(body.messages.filter((message: any) => message.role === 'user').at(-1)?.content);
const systemText = (body: any): string => body.messages.filter((message: any) => message.role === 'system' || message.role === 'developer').map((message: any) => contentText(message.content)).join('\n');
const roleOf = (record: RequestRecord): 'researcher' | 'reviewer' | undefined => {
  if (record.system.includes('the isolated role deep-research/researcher')) return 'researcher';
  if (record.system.includes('the isolated role deep-research/reviewer')) return 'reviewer';
  return undefined;
};
const methodReference = path.join(process.cwd(), 'extensions/analysis-assets/deep-research/references/method.md');
const skillBaseDir = path.join(process.cwd(), 'extensions/analysis-assets/deep-research');

function respond(response: ServerResponse, body: any, text?: string, tool?: { name: string; args: unknown }) {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (delta: unknown, finish: string | null = null) => response.write('data: ' + JSON.stringify({ id: 'deep-research-fixture', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n');
  send({ role: 'assistant', content: '' });
  if (tool) { send({ tool_calls: [{ index: 0, id: randomUUID(), type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] }); send({}, 'tool_calls'); }
  else { send({ content: text ?? 'DR_SYNTHETIC_DONE' }); send({}, 'stop'); }
  response.end('data: [DONE]\n\n');
}

async function fixture(t: TestContext) {
  const evidence = path.resolve('.local/deep-research-skill');
  await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(path.join(evidence, 'e2e-'));
  const projectDirectory = path.join(root, 'project'), resourceRoot = path.join(root, 'resources');
  for (const directory of [path.join(projectDirectory, '020_clean'), path.join(projectDirectory, '060_reports'), resourceRoot]) await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(resourceRoot, 'settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const requests: RequestRecord[] = [];
  let dispatch: Record<string, unknown> = { agent: 'deep-research/researcher', task: 'DR_TOPIC_DEFAULT' };
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()), record: RequestRecord = { body, authorization: request.headers.authorization, system: systemText(body) };
      requests.push(record);
      const role = roleOf(record), prompt = userText(body);
      const results = body.messages.slice((body.messages.findLastIndex((message: any) => message.role === 'user') as number) + 1).filter((message: any) => message.role === 'tool');
      if (!role) {
        if (results.length) respond(response, body, 'PARENT_RESULT\n' + results.map((message: any) => contentText(message.content)).join('\n'));
        else respond(response, body, undefined, { name: 'subagent', args: dispatch });
      } else if (prompt.includes('DR_READ_METHOD')) {
        if (results.length === 0) respond(response, body, undefined, { name: 'read', args: { path: methodReference } });
        else respond(response, body, 'DR_METHOD_DONE\n' + results.map((message: any) => contentText(message.content)).join('\n'));
      } else if (prompt.includes('DR_CHAPTER_SOURCE')) respond(response, body, 'DR_RESEARCH_DRAFT_READY');
      else if (prompt.includes('DR_REVIEW')) respond(response, body, 'DR_REVIEW_VERDICT_ON: ' + prompt);
      else respond(response, body, `DR_ROLE=${role};DR_TASK=${prompt}`);
    } catch { response.writeHead(500); response.end('synthetic fixture failure'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const options: ProjectAgentOptions = { projectId: 'deep-research-e2e', projectDirectory, resourceRoot, sessionDirectory: path.join(root, 'sessions'), codeRoot: process.cwd(), managementPorts: [], configuration: { id: 'deep-research-fixture', revision: 1, name: 'Synthetic deep-research fixture', provider: 'synthetic', api: 'openai-completions', baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'synthetic-deep-research-model', apiKey: 'synthetic-deep-research-only-key' } };
  const agents: ProjectAgent[] = [];
  const create = (overrides: Partial<ProjectAgentOptions> = {}) => { const agent = new ProjectAgent({ ...options, ...overrides }); agents.push(agent); return agent; };
  t.after(async () => { for (const agent of agents) await agent.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await writeFile(path.join(root, 'requests.json'), JSON.stringify(requests.map(record => ({ model: record.body.model, system: record.system, messages: record.body.messages })), null, 2)); });
  return { create, requests, dispatch: (value: Record<string, unknown>) => { dispatch = value; }, root };
}

test('DR03: the real deep-research skill delegates isolated researcher and reviewer through the product seam', { timeout: 45_000 }, async t => {
  const f = await fixture(t), agent = f.create();
  const snapshot = await agent.open();
  assert.ok(snapshot.tools.includes('subagent'), 'the delegation tool is present for ordinary tasks');
  f.dispatch({ agent: 'deep-research/researcher', task: 'DR_TOPIC_AI_AGENT' });
  const single = await agent.start('PARENT_PRIVATE_SINGLE', randomUUID()).completion;
  assert.equal(single.outcome, 'completed', JSON.stringify(single));
  assert.match(single.text, /DR_ROLE=researcher;DR_TASK=DR_TOPIC_AI_AGENT/);
  f.dispatch({ chain: [{ agent: 'deep-research/researcher', task: 'DR_CHAPTER_SOURCE' }, { agent: 'deep-research/reviewer', task: 'DR_REVIEW {previous}' }] });
  const chained = await agent.start('PARENT_PRIVATE_CHAIN', randomUUID()).completion;
  assert.equal(chained.outcome, 'completed', JSON.stringify(chained));
  assert.match(chained.text, /DR_REVIEW_VERDICT_ON: .*DR_RESEARCH_DRAFT_READY/, 'chain passes the prior result to the reviewer');
  const children = f.requests.filter(record => roleOf(record));
  assert.equal(children.length, 3, 'each delegation used a real SDK request');
  for (const record of f.requests) { assert.equal(record.body.model, 'synthetic-deep-research-model'); assert.equal(record.authorization, 'Bearer synthetic-deep-research-only-key'); }
  for (const record of children) {
    assert.equal(record.body.messages.filter((message: any) => message.role === 'user').length, 1, 'delegated contexts begin fresh');
    assert.doesNotMatch(JSON.stringify(record.body.messages), /PARENT_PRIVATE_/, 'parent conversation is not copied into role sessions');
    assert.ok(!names(record.body).includes('subagent'), 'roles cannot recursively spawn further sessions');
    assert.ok(record.system.includes(`Skill resources are at ${skillBaseDir}`), 'children learn the real skill resource root');
  }
  const researcher = children.filter(record => roleOf(record) === 'researcher');
  assert.ok(researcher.length >= 1 && researcher.every(record => record.system.includes('调研员（researcher）')), 'the real researcher role body is the delegated system instruction');
  const reviewer = children.filter(record => roleOf(record) === 'reviewer');
  assert.ok(reviewer.length === 1 && reviewer.every(record => record.system.includes('审稿人（reviewer）')), 'the real reviewer role body is the delegated system instruction');
});

test('DR03: a delegated researcher reads the real method reference shipped with the skill', { timeout: 45_000 }, async t => {
  const f = await fixture(t), agent = f.create();
  await agent.open();
  f.dispatch({ agent: 'deep-research/researcher', task: 'DR_READ_METHOD 查阅研究方法后开工' });
  const result = await agent.start('PARENT_PRIVATE_METHOD', randomUUID()).completion;
  assert.equal(result.outcome, 'completed', JSON.stringify(result));
  assert.match(result.text, /DR_METHOD_DONE/);
  const expected = await readFile(methodReference, 'utf8');
  assert.ok(result.text.includes(expected.slice(0, 200).trim().split('\n')[0] ?? 'DR_MISSING_MARKER'), 'the child actually read the shipped reference heading');
  const child = f.requests.filter(record => roleOf(record) === 'researcher');
  assert.equal(child.length, 2, 'the child performed its read call and returned the verdict');
});
