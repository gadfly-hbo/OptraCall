import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHost } from '../src/host/server.ts';
import { providerMessageText, startToolProvider, type ToolProviderBody } from './fixtures/tool-provider.ts';

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) assert.fail(`Synthetic operation did not settle: ${JSON.stringify(value)}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

async function fixture(t: TestContext) {
  const root = path.resolve('.local/agent-output-reliability/guidance', randomUUID());
  await mkdir(root, { recursive: true });
  const provider = await startToolProvider();
  const host = createHost({ cwd: process.cwd(), dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects'), uiPorts: [4183], transportVersion: 'synthetic-output-evidence' });
  await host.ready;
  await new Promise<void>(resolve => host.server.listen(0, '127.0.0.1', resolve));
  const address = host.server.address(); assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  async function request(route: string, method = 'GET', body?: object, status = 200): Promise<any> {
    const response = await fetch(baseUrl + route, { method, headers: { 'content-type': 'application/json', 'x-optracall-client': '1', origin: 'http://127.0.0.1:4183' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value;
  }
  t.after(async () => {
    try { await host.close(); }
    finally {
      await provider.close();
      await writeFile(path.join(root, 'requests.json'), JSON.stringify(provider.requests.map(item => item.body), null, 2));
    }
  });
  await request('/api/configuration', 'PUT', { name: '出稿材料交付合成模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-output-evidence', apiKey: 'synthetic-guidance-key' });
  const { project } = await request('/api/projects', 'POST', { name: '出稿证据隔离合成项目' }, 201);
  const { task } = await request(`/api/projects/${project.id}/tasks`, 'POST', { name: '保留原分析任务' }, 201);
  return { root, provider, request, project, task, taskRoute: `/api/projects/${project.id}/tasks/${task.id}` };
}

function systemText(body: ToolProviderBody) {
  return (body.messages ?? []).filter(message => message.role === 'system').map(message => providerMessageText(message.content)).join('\n');
}

function assertEvidenceGuidance(text: string) {
  assert.match(text, /Output evidence \(use when relevant\)/);
  for (const term of ['totals', 'rankings', 'denominators', 'scope', 'all', 'largest', 'doubled']) assert.ok(text.includes(term), `Missing evidence concern: ${term}`);
  assert.match(text, /actual sources or results.*read back/);
  assert.match(text, /another suitable approach/);
  assert.match(text, /Skip inapplicable/);
  assert.match(text, /narrow or remove.*unknown/s);
}

test('OR04: actual verification requests receive evidence responsibility while cold reveal and original history stay intact', { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  await f.request(f.taskRoute + '/messages', 'POST', { requestId: randomUUID(), text: '只描述已知条件，保留原会话。' }, 202);
  const original = await until(() => f.request(f.taskRoute), value => value.task.lastRun?.status === 'completed');
  const nativeBefore = await readFile(original.task.sessionFile);
  const data = 'group,amount\nX,7\nY,11\n', author = 'SEALED_AUTHOR_ONLY：这里是待核查原稿。';
  await f.request(`/api/projects/${f.project.id}/files/upload`, 'POST', { directory: '020_clean', name: 'source.csv', content: Buffer.from(data).toString('base64') }, 201);
  await f.request(`/api/projects/${f.project.id}/files/save-report`, 'POST', { name: 'author.md', text: author }, 201);
  const verificationId = randomUUID(), route = f.taskRoute + '/verifications/' + verificationId;
  f.provider.setResponder(context => {
    const user = providerMessageText(context.messages.filter(message => message.role === 'user').at(-1)?.content);
    if (user.includes('独立核算任务')) {
      if (!context.recentToolResults.length) return { calls: [{ name: 'read', arguments: { path: 'inputs/020_clean/source.csv' } }] };
      assert.match(providerMessageText(context.recentToolResults[0].content), /X,7/);
      return { text: 'COLD_RESULT_SAVED：已读取固定输入，业务前提未知。' };
    }
    assert.match(user, /SEALED_AUTHOR_ONLY/);
    return { text: 'COMPARISON_SAVED：仅对照固定范围，新增判断仍需实际依据。' };
  });
  await f.request(f.taskRoute + '/verifications', 'POST', { verificationId, question: '自主核对金额与表述，保留未知。', dataFiles: ['020_clean/source.csv'], authorFiles: ['060_reports/author.md'] }, 202);
  const result = await until(async () => (await f.request(route)).verification, value => ['completed', 'failed', 'unknown', 'cancelled'].includes(value.status));
  assert.equal(result.status, 'completed', JSON.stringify(result));
  const requests = f.provider.requests.slice(1).map(item => item.body);
  assert.equal(requests.length, 3, 'One independent tool call and one comparison turn; no automatic review loop');
  const cold = JSON.stringify(requests[0].messages), comparison = JSON.stringify(requests[2].messages);
  assert.doesNotMatch(cold, /SEALED_AUTHOR_ONLY|author\.md/);
  assert.match(comparison, /COLD_RESULT_SAVED/);
  assert.match(comparison, /SEALED_AUTHOR_ONLY/);
  assertEvidenceGuidance(systemText(requests[0]));
  assert.match(systemText(requests[2]), /finding an author error does not prove/);
  assert.match(systemText(requests[2]), /own new calculation or inference/);
  assert.ok(requests[0].tools?.some(tool => tool.function?.name === 'bash'));
  assert.match(result.coldResult.text, /COLD_RESULT_SAVED/);
  assert.match(result.comparisonResult.text, /COMPARISON_SAVED/);
  assert.deepEqual((await f.request(f.taskRoute)).task, original.task);
  assert.deepEqual(await readFile(original.task.sessionFile), nativeBefore);
  assert.equal(await readFile(path.join(f.project.rootPath, '020_clean/source.csv'), 'utf8'), data);
  assert.equal(await readFile(path.join(f.project.rootPath, '060_reports/author.md'), 'utf8'), author);
  assert.deepEqual(f.provider.errors, []);
});

test('OR03/04: normal analysis receives optional guidance while fixed-draft, extraction and requirement contracts stay separate', { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  await f.request(f.taskRoute + '/messages', 'POST', { requestId: randomUUID(), text: '这是描述性任务，请只说明未知条件，不需要金额桥接。' }, 202);
  const original = await until(() => f.request(f.taskRoute), value => value.task.lastRun?.status === 'completed');
  assertEvidenceGuidance(systemText(f.provider.requests[0].body));
  assert.ok(f.provider.requests[0].body.tools?.some(tool => tool.function?.name === 'bash'));
  const nativeBefore = await readFile(original.task.sessionFile);
  await f.request(`/api/projects/${f.project.id}/files/upload`, 'POST', { directory: '020_clean', name: 'data.csv', content: Buffer.from('id,value\na,3\n').toString('base64') }, 201);
  await f.request(`/api/projects/${f.project.id}/files/save-report`, 'POST', { name: 'author.md', text: 'FIXED_SOURCE_REPORT：资料有限，尚不能提出建议。' }, 201);
  const verificationId = randomUUID(), route = f.taskRoute + '/verifications/' + verificationId;
  await f.request(f.taskRoute + '/verifications', 'POST', { verificationId, question: '说明核查范围。', dataFiles: ['020_clean/data.csv'], authorFiles: ['060_reports/author.md'] }, 202);
  const verification = await until(async () => (await f.request(route)).verification, value => ['completed', 'failed', 'unknown'].includes(value.status));
  assert.equal(verification.status, 'completed');
  f.provider.setResponder(() => ({ text: 'NEW_DRAFT_TEXT_ONLY：仍保留未知。' }));
  await f.request(route + '/author-revision', 'POST', {}, 202);
  const revised = await until(async () => (await f.request(route)).verification, value => Boolean(value.revision?.status && value.revision.status !== 'running'));
  assert.equal(revised.revision.status, 'completed');
  const draftRequest = f.provider.requests.at(-1)!.body;
  assert.equal(draftRequest.tools?.length ?? 0, 0);
  assert.doesNotMatch(systemText(draftRequest), /Output evidence|actual sources or results/);
  assert.equal(await readFile(path.join(f.project.rootPath, revised.revision.files[0]), 'utf8'), 'NEW_DRAFT_TEXT_ONLY：仍保留未知。');

  f.provider.setResponder(() => ({ text: '```json\n[]\n```' }));
  await f.request('/api/decision-board/reports/extract', 'POST', { projectId: f.project.id, path: '060_reports/author.md' }, 202);
  const board = await until(() => f.request('/api/decision-board'), value => ['completed', 'failed', 'cancelled'].includes(value.reports.find((report: any) => report.relativePath === '060_reports/author.md')?.extraction?.status));
  assert.equal(board.reports.find((report: any) => report.relativePath === '060_reports/author.md').extraction.status, 'completed');
  const extractionRequest = f.provider.requests.at(-1)!.body;
  assert.equal(extractionRequest.tools?.length ?? 0, 0);
  assert.doesNotMatch(systemText(extractionRequest), /Output evidence|actual sources or results/);

  f.provider.setResponder(() => ({ text: JSON.stringify({ clarifications: [{ category: '指标口径', priority: 'should_confirm', question: '需要描述哪些未知条件？', rationale: '只澄清实际缺口' }], facts: [], hypotheses: [] }) }));
  const { instance } = await f.request('/api/requirement-instances', 'POST', { title: '无需执行数据分析的需求', scene: 'daily' }, 201);
  const generated = await f.request(`/api/requirement-instances/${instance.id}/generate`, 'POST', { call: 'elicit' });
  assert.equal(generated.repairAttempts, 0);
  assert.equal(generated.proposal.clarifications[0].question, '需要描述哪些未知条件？');
  assert.doesNotMatch(systemText(f.provider.requests.at(-1)!.body), /Output evidence|actual sources or results/);
  assert.equal(f.provider.requests.length, 6, 'Existing explicit operations dispatch once, without a new automatic review');
  assert.deepEqual((await f.request(f.taskRoute)).task, original.task);
  assert.deepEqual(await readFile(original.task.sessionFile), nativeBefore);
  assert.equal(await readFile(path.join(f.project.rootPath, '060_reports/author.md'), 'utf8'), 'FIXED_SOURCE_REPORT：资料有限，尚不能提出建议。');
  assert.deepEqual(f.provider.errors, []);
});
