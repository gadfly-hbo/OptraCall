import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';

test('PM-V12-01: an explicitly chosen Project background is discoverable and accurately readable before manual selection', { timeout: 60000 }, async t => {
  const root = path.resolve('.local/v12-pm01-fix/host'); await mkdir(root, { recursive: true });
  const evidence = await mkdtemp(path.join(root, 'auto-background-'));
  const provider = await startToolProvider();
  const host = await startTestHost({ dataRoot: path.join(evidence, 'host'), projectsRoot: path.join(evidence, 'projects') });
  t.after(async () => { await host.close(); await provider.close(); });
  const request = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const response = await host.request(route, method, body); assert.equal(response.status, status, await response.clone().text()); return response.json();
  };
  await request('/api/configuration', 'PUT', { name: 'PM01 local synthetic', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-pm01', apiKey: 'synthetic-pm01-only' });
  const { project } = await request('/api/projects', 'POST', { name: '服饰零售会员复购背景范围' }, 201);
  const body = '经营计划：仅背景说明。会员期间口径不可比，供货与季节是待核替代解释；没有交易明细，也不授权发券。';
  await request(`/api/projects/${project.id}/files/upload`, 'POST', { name: '经营计划.md', directory: '020_clean', content: Buffer.from(body).toString('base64') }, 201);
  const { discussion } = await request('/api/strategy/discussions', 'POST', { operationId: randomUUID(), projectId: project.id, sources: [], usageContext: { kind: 'organization', background: '明确本项目的获准背景范围，未手选也未限选' } }, 201);
  const directory = await request(`/api/strategy/discussions/${discussion.id}/sources`);
  assert.equal(directory.sources.length, 1, 'the original permission-filtered catalogue already exists');
  let discovered: any, read: any;
  provider.setResponder(call => {
    if (!call.recentToolResults.length) return { calls: [{ name: 'strategy_goals', arguments: { action: 'find-sources' } }] };
    const latest = JSON.parse(providerMessageText(call.recentToolResults.at(-1)?.content));
    if (latest.claim === 'catalog-not-read') {
      discovered = latest;
      return latest.sources?.length ? { calls: [{ name: 'strategy_goals', arguments: { action: 'read-source', sourceId: latest.sources[0].id } }] } : { text: '目录没有资料，无法自主读取。' };
    }
    read = latest; return { text: '只核真实返回的背景范围，专业判断尚未验证。' };
  });
  const requestId = randomUUID();
  await request(`/api/strategy/discussions/${discussion.id}/messages`, 'POST', { requestId, expectedRevision: discussion.revision, text: '请在本项目获准背景范围内，自主查找并读取经营计划；没有限定手选清单。' }, 202);
  let detail: any;
  for (let i = 0; i < 300; i++) { detail = await request(`/api/strategy/discussions/${discussion.id}`); if (!detail.busy && detail.discussion.lastRun?.status === 'completed') break; await delay(20); }
  await writeFile(path.join(evidence, 'observation.json'), JSON.stringify({ requestId, directory, discovered, read, detail, providerRequests: provider.requests.length }, null, 2));
  assert.equal(detail.discussion.lastRun?.status, 'completed');
  assert.ok(discovered?.sources?.some((source: any) => source.title === '经营计划.md'), 'Agent must discover the permitted background without human per-file selection');
  assert.equal(read?.read?.text, body, 'actual returned body, not catalogue visibility, proves the read');
  assert.deepEqual(read.read.range, { start: 0, end: body.length, total: body.length });
  assert.equal(read.read.complete, true); assert.equal(read.source.sha256, directory.sources[0].sha256);
  assert.equal(detail.discussion.sources.length, 0, 'autonomous reads do not rewrite manual choices');
  const native = await readFile(detail.snapshot.sessionFile, 'utf8');
  assert.ok(native.includes('catalog-not-read')); assert.ok(native.includes(body));
  t.diagnostic(evidence);
});

test('PM-V12-01: an autonomously read background remains bound to its original Project when an adopted Goal is read by a receiving Task', { timeout: 60000 }, async t => {
  const root = path.resolve('.local/v12-pm01-fix/host'); await mkdir(root, { recursive: true });
  const evidence = await mkdtemp(path.join(root, 'auto-downstream-'));
  const provider = await startToolProvider(), host = await startTestHost({ dataRoot: path.join(evidence, 'host'), projectsRoot: path.join(evidence, 'projects') });
  t.after(async () => { await host.close(); await provider.close(); });
  const request = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => { const response = await host.request(route, method, body); assert.equal(response.status, status, await response.clone().text()); return response.json(); };
  await request('/api/configuration', 'PUT', { name: 'original background model', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-pm01-original', apiKey: 'synthetic-pm01-only' });
  const original = (await request('/api/projects', 'POST', { name: '原背景资料项目' }, 201)).project;
  const marker = 'PM01_PRIVATE_DETAIL_BOUND_TO_ORIGINAL_PROJECT';
  await request(`/api/projects/${original.id}/files/upload`, 'POST', { name: '经营计划.md', directory: '020_clean', content: Buffer.from(marker).toString('base64') }, 201);
  const { discussion } = await request('/api/strategy/discussions', 'POST', { operationId: randomUUID(), projectId: original.id, sources: [] }, 201);
  const draft = { title: '可独立承接的公开目标', outcome: '核对当期已知安排', perspective: 'personal', scope: { kind: 'personal', id: 'self', name: '本人' }, measurement: { kind: 'deliverable', criterion: '可核对安排' }, baseline: { state: 'pending', description: '可比基线待补' }, responsible: '本人' };
  let actualRead: any;
  provider.setResponder(call => {
    if (!call.recentToolResults.length) return { calls: [{ name: 'strategy_goals', arguments: { action: 'find-sources' } }] };
    const value = JSON.parse(providerMessageText(call.recentToolResults.at(-1)?.content));
    if (value.claim === 'catalog-not-read') return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-source', sourceId: value.sources[0].id } }] };
    if (value.read) { actualRead = value; return { text: marker, calls: [{ name: 'strategy_goals', arguments: { action: 'propose-goal', draft } }] }; }
    return { text: '候选准确保存，尚未采用。' };
  });
  await request(`/api/strategy/discussions/${discussion.id}/messages`, 'POST', { requestId: randomUUID(), expectedRevision: discussion.revision, text: '明确使用原项目获准背景，先查读后形成可独立承接的候选。' }, 202);
  let detail: any;
  for (let i = 0; i < 300; i++) { detail = await request(`/api/strategy/discussions/${discussion.id}`); if (!detail.busy && detail.discussion.lastRun?.status === 'completed') break; await delay(20); }
  assert.equal(actualRead?.read?.text, marker, 'this case really reads the source before producing a candidate');
  const goal = detail.goals[0]; assert.ok(goal); assert.ok(!JSON.stringify(goal).includes(marker), 'formal Goal remains independently usable without detailed private carrier');
  await request(`/api/strategy/discussions/${discussion.id}/adopt`, 'POST', { operationId: randomUUID(), goalId: goal.goalId, version: goal.version, expectedVersion: goal.version, goalContentSha256: detail.goalContentHashes[`${goal.goalId}:${goal.version}`], decision: '明确采用该准确目标，详细原背景仍按接收者资格。' });
  await request('/api/configuration', 'PUT', { name: 'receiving model', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-pm01-receiver', apiKey: 'synthetic-pm01-only' });
  const receiving = (await request('/api/projects', 'POST', { name: '另一接收项目' }, 201)).project;
  const plan = { request: '只核准确目标背景，不增加详细原材料权限', premises: [], materials: [], coverage: [], tasks: [{ key: 'work', name: '接收者核对', selected: true, scope: '继续独立可行部分', capabilities: [] }], taskMode: 'single', summaryTaskKey: 'work', dependencies: [], caseContext: null, goalContext: { goal: { goalId: goal.goalId, version: goal.version }, purpose: 'assigned-work' } };
  await request(`/api/projects/${receiving.id}/plan/draft`, 'POST', { operationId: randomUUID(), expectedRevision: 0, plan });
  const planState = await request(`/api/projects/${receiving.id}/plan`); let toolReply = '';
  provider.setResponder(call => !call.recentToolResults.length ? { calls: [{ name: 'read_goal_context_source', arguments: { goalId: goal.goalId, version: goal.version } }] } : (toolReply = providerMessageText(call.recentToolResults.at(-1)?.content), { text: '来源资格单独核对，目标仍可独立工作。' }));
  const confirmation = await request(`/api/projects/${receiving.id}/plan/confirm`, 'POST', { operationId: randomUUID(), expectedRevision: planState.revision, mode: 'start' });
  const task = confirmation.confirmation.tasks[0]; let actual: any;
  for (let i = 0; i < 300; i++) { actual = await request(`/api/projects/${receiving.id}/tasks/${task.taskId}`); if (actual.task.lastRun?.status === 'completed' && actual.snapshot.status === 'idle') break; await delay(20); }
  await writeFile(path.join(evidence, 'observation.json'), JSON.stringify({ original, receiving, actualRead, goal, task, toolReply, actual }, null, 2));
  assert.equal(actual.task.lastRun.status, 'completed');
  assert.ok(!toolReply.includes(marker), 'automatic discovery/read must not bypass actual receiving Project qualification');
  assert.match(toolReply, /not_authorized|unavailable|not_delivered/);
  t.diagnostic(evidence);
});

for (const boundary of ['explicit-exclusion', 'selected-only-empty', 'clear-project'] as const) test(`PM-V12-01: narrowing an already read background (${boundary}) prevents redispatching native history and preserves the new input`, { timeout: 60000 }, async t => {
  const root = path.resolve('.local/v12-pm01-fix/host'); await mkdir(root, { recursive: true });
  const evidence = await mkdtemp(path.join(root, `history-${boundary}-`));
  const provider = await startToolProvider(), host = await startTestHost({ dataRoot: path.join(evidence, 'host'), projectsRoot: path.join(evidence, 'projects') });
  t.after(async () => { await host.close(); await provider.close(); });
  const request = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => { const response = await host.request(route, method, body); assert.equal(response.status, status, await response.clone().text()); return response.json(); };
  await request('/api/configuration', 'PUT', { name: 'history scope', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-pm01-history', apiKey: 'synthetic-pm01-only' });
  const { project } = await request('/api/projects', 'POST', { name: '明确历史范围' }, 201);
  await request(`/api/projects/${project.id}/files/upload`, 'POST', { name: '经营计划.md', directory: '020_clean', content: Buffer.from('PM01_READ_BEFORE_EXCLUSION').toString('base64') }, 201);
  const { discussion } = await request('/api/strategy/discussions', 'POST', { operationId: randomUUID(), projectId: project.id, sources: [] }, 201);
  let read: any;
  provider.setResponder(call => {
    if (!call.recentToolResults.length) return { calls: [{ name: 'strategy_goals', arguments: { action: 'find-sources' } }] };
    const value = JSON.parse(providerMessageText(call.recentToolResults.at(-1)?.content));
    if (value.claim === 'catalog-not-read') return value.sources.length ? { calls: [{ name: 'strategy_goals', arguments: { action: 'read-source', sourceId: value.sources[0].id } }] } : { text: '没有可用背景。' };
    read = value; return { text: '只使用实际返回背景。' };
  });
  await request(`/api/strategy/discussions/${discussion.id}/messages`, 'POST', { requestId: randomUUID(), expectedRevision: discussion.revision, text: '明确读取本项目背景。' }, 202);
  let original: any;
  for (let i = 0; i < 300; i++) { original = await request(`/api/strategy/discussions/${discussion.id}`); if (!original.busy && original.discussion.lastRun?.status === 'completed') break; await delay(20); }
  assert.equal(read.read.text, 'PM01_READ_BEFORE_EXCLUSION');
  const nativeBefore = await readFile(original.snapshot.sessionFile);
  const patch = boundary === 'clear-project' ? { projectId: null, sources: [], sourceScope: { mode: 'project-background' } } : boundary === 'selected-only-empty' ? { sources: [], sourceScope: { mode: 'selected-only' } } : { sourceScope: { mode: 'project-background', excludedSources: [read.source] } };
  const { discussion: changed } = await request(`/api/strategy/discussions/${discussion.id}`, 'PATCH', { expectedRevision: original.discussion.revision, ...patch });
  const input = { requestId: randomUUID(), expectedRevision: changed.revision, text: `已明确收窄本轮背景范围（${boundary}），不要把旧资料当作已经忘记。` };
  const beforeRequests = provider.requests.length;
  const response = await host.request(`/api/strategy/discussions/${discussion.id}/messages`, 'POST', input); const result = await response.json() as any;
  const after = await request(`/api/strategy/discussions/${discussion.id}`);
  await writeFile(path.join(evidence, 'observation.json'), JSON.stringify({ input, status: response.status, result, beforeRequests, afterRequests: provider.requests.length, after }, null, 2));
  assert.equal(response.status, 409, 'existing native body outside the explicitly narrowed scope cannot be redispatched');
  assert.equal(result.code, 'strategy_discussion_history_scope_changed');
  assert.match(result.message, /本次未发送给模型/);
  assert.equal(provider.requests.length, beforeRequests);
  assert.equal(after.discussion.pendingInput.text, input.text); assert.equal(after.discussion.pendingInput.requestId, input.requestId);
  assert.deepEqual(await readFile(original.snapshot.sessionFile), nativeBefore);
  t.diagnostic(evidence);
});

test('PM-V12-01: explicit empty limits, optional manual selection and exclusions control actual tools without treating unprovided bodies as read', { timeout: 60000 }, async t => {
  const root = path.resolve('.local/v12-pm01-fix/host'); await mkdir(root, { recursive: true });
  const evidence = await mkdtemp(path.join(root, 'explicit-scope-'));
  const provider = await startToolProvider(), host = await startTestHost({ dataRoot: path.join(evidence, 'host'), projectsRoot: path.join(evidence, 'projects') });
  t.after(async () => { await host.close(); await provider.close(); });
  const request = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => { const response = await host.request(route, method, body); assert.equal(response.status, status, await response.clone().text()); return response.json(); };
  await request('/api/configuration', 'PUT', { name: 'explicit bounds', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-pm01-explicit', apiKey: 'synthetic-pm01-only' });
  const { project } = await request('/api/projects', 'POST', { name: '仅限明确背景' }, 201);
  for (const name of ['允许计划.md', '排除计划.md']) await request(`/api/projects/${project.id}/files/upload`, 'POST', { name, directory: '020_clean', content: Buffer.from(`准确正文：${name}；完整内容不可由目录宣称已读。`).toString('base64') }, 201);
  let owner = (await request('/api/strategy/discussions', 'POST', { operationId: randomUUID(), projectId: project.id, sources: [], sourceScope: { mode: 'selected-only' } }, 201)).discussion;
  const directory = (await request(`/api/strategy/discussions/${owner.id}/sources`)).sources;
  const allowed = directory.find((s: any) => s.title === '允许计划.md'), excluded = directory.find((s: any) => s.title === '排除计划.md');
  const observations: any[] = [];
  const run = async (text: string) => {
    const input = { requestId: randomUUID(), expectedRevision: owner.revision, text };
    await request(`/api/strategy/discussions/${owner.id}/messages`, 'POST', input, 202);
    let detail: any;
    for (let i = 0; i < 300; i++) { detail = await request(`/api/strategy/discussions/${owner.id}`); if (!detail.busy && detail.discussion.lastRun?.status === 'completed') break; await delay(20); }
    assert.equal(detail.discussion.lastRun.status, 'completed'); owner = detail.discussion;
    const count = provider.requests.length;
    await request(`/api/strategy/discussions/${owner.id}/messages`, 'POST', input, 202);
    assert.equal(provider.requests.length, count, 'exact duplicate is a receipt read, not a second dispatch');
    return detail;
  };
  provider.setResponder(call => {
    if (!call.recentToolResults.length) return { calls: [{ name: 'strategy_goals', arguments: { action: 'find-sources' } }, { name: 'strategy_goals', arguments: { action: 'read-source', sourceId: allowed.id } }] };
    observations.push(call.recentToolResults.map(r => providerMessageText(r.content))); return { text: '范围为空，没有读取背景，继续独立说明。' };
  });
  await run('明确只使用空手选清单，不使用项目背景；继续说明缺口。');
  assert.match(observations[0][0], /"sources":\[\]/); assert.match(observations[0][1], /not_selected/);
  owner = (await request(`/api/strategy/discussions/${owner.id}`, 'PATCH', { expectedRevision: owner.revision, sources: [allowed] })).discussion;
  // A selected reference is only metadata until read-source succeeds.
  provider.setResponder(call => call.recentToolResults.length ? { text: '仅看目录，没有读取正文。' } : { calls: [{ name: 'strategy_goals', arguments: { action: 'find-sources' } }] });
  const selectedButUnread = await run('只查看手选目录，本轮不读正文。');
  const nativeBefore = await readFile(selectedButUnread.snapshot.sessionFile, 'utf8');
  assert.ok(!nativeBefore.includes('准确正文：允许计划.md'));
  owner = (await request(`/api/strategy/discussions/${owner.id}`, 'PATCH', { expectedRevision: owner.revision, sources: [], sourceScope: { mode: 'selected-only' } })).discussion;
  provider.setResponder(() => ({ text: '未读正文不应阻断后续独立讨论。' }));
  await run('清空手选资料，继续独立讨论。');
  owner = (await request(`/api/strategy/discussions/${owner.id}`, 'PATCH', { expectedRevision: owner.revision, sources: [allowed], sourceScope: { mode: 'selected-only', excludedSources: [excluded] } })).discussion;
  let read: any;
  provider.setResponder(call => {
    if (!call.recentToolResults.length) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-source', sourceId: allowed.id, offset: 0, limit: 4 } }, { name: 'strategy_goals', arguments: { action: 'read-source', sourceId: excluded.id } }] };
    const values = call.recentToolResults.map(r => providerMessageText(r.content)); observations.push(values); read = JSON.parse(values[0]); return { text: '只读取手选资料的四字片段，其他内容未读。' };
  });
  const final = await run('明确限选允许计划，只读四字；排除计划不得读。');
  assert.equal(read.read.text, '准确正文'); assert.deepEqual(read.read.range, { start: 0, end: 4, total: '准确正文：允许计划.md；完整内容不可由目录宣称已读。'.length }); assert.equal(read.read.complete, false);
  assert.match(observations.at(-1)[1], /not_selected|excluded/);
  const native = await readFile(final.snapshot.sessionFile, 'utf8');
  const entries = native.trim().split('\n').map(line => JSON.parse(line));
  const reads = entries.filter(e => e.type === 'message' && e.message.role === 'toolResult' && !e.message.isError && e.message.toolName === 'strategy_goals').flatMap(e => { try { const v = JSON.parse(e.message.content.map((c: any) => c.text || '').join('')); return v.read ? [v] : []; } catch { return []; } });
  assert.equal(reads.length, 1, 'only successful actual narrow read is recorded as body delivery');
  await writeFile(path.join(evidence, 'observation.json'), JSON.stringify({ directory, observations, read, detail: final, actualBodyReads: reads, providerRequests: provider.requests.length }, null, 2));
  t.diagnostic(evidence);
});

test('PM-V12-01: the original large background catalogue remains discoverable in bounded pages rather than failing or claiming all bodies were read', { timeout: 60000 }, async t => {
  const root = path.resolve('.local/v12-pm01-fix/host'); await mkdir(root, { recursive: true });
  const evidence = await mkdtemp(path.join(root, 'catalog-pages-'));
  const provider = await startToolProvider(), host = await startTestHost({ dataRoot: path.join(evidence, 'host'), projectsRoot: path.join(evidence, 'projects') });
  t.after(async () => { await host.close(); await provider.close(); });
  const request = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => { const r = await host.request(route, method, body); assert.equal(r.status, status, await r.clone().text()); return r.json(); };
  await request('/api/configuration', 'PUT', { name: 'bounded catalogue', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-pm01-pages', apiKey: 'synthetic-pm01-only' });
  const { project } = await request('/api/projects', 'POST', { name: '已有多份背景资料' }, 201);
  for (let i = 0; i < 80; i++) await request(`/api/projects/${project.id}/files/upload`, 'POST', { name: `已有经营计划背景-${String(i).padStart(2, '0')}-${'资料'.repeat(30)}.md`, directory: '020_clean', content: Buffer.from(`准确背景${i}，非明细`).toString('base64') }, 201);
  const { discussion } = await request('/api/strategy/discussions', 'POST', { operationId: randomUUID(), projectId: project.id, sources: [] }, 201);
  const pages: any[] = []; let read: any, toolError = '';
  provider.setResponder(call => {
    if (!call.recentToolResults.length) return { calls: [{ name: 'strategy_goals', arguments: { action: 'find-sources' } }] };
    const raw = providerMessageText(call.recentToolResults.at(-1)?.content); let value: any; try { value = JSON.parse(raw); } catch { toolError = raw; return { text: '目录返回失败，未读正文。' }; }
    if (value.claim === 'catalog-not-read') {
      pages.push(value);
      if (!value.complete && Number.isSafeInteger(value.nextOffset)) return { calls: [{ name: 'strategy_goals', arguments: { action: 'find-sources', offset: value.nextOffset } }] };
      return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-source', sourceId: value.sources.at(-1).id, limit: 4 } }] };
    }
    read = value; return { text: '只读最后一份四字片段，其他目录项未读。' };
  });
  await request(`/api/strategy/discussions/${discussion.id}/messages`, 'POST', { requestId: randomUUID(), expectedRevision: discussion.revision, text: '明确本项目背景范围，自主分页查看已有目录，再只读一份片段。' }, 202);
  let detail: any; for (let i = 0; i < 300; i++) { detail = await request(`/api/strategy/discussions/${discussion.id}`); if (!detail.busy && detail.discussion.lastRun?.status === 'completed') break; await delay(20); }
  await writeFile(path.join(evidence, 'observation.json'), JSON.stringify({ pages, read, toolError, detail, providerRequests: provider.requests.length }, null, 2));
  assert.equal(toolError, '', 'large metadata is available through the same bounded tool, not a materials_too_large failure');
  assert.ok(pages.length > 1); assert.equal(pages.flatMap(page => page.sources).length, 80);
  assert.ok(pages.every(page => JSON.stringify(page).length <= 32768)); assert.equal(pages.at(-1).complete, true);
  assert.equal(read.read.text.length, 4); assert.equal(read.read.complete, false); assert.deepEqual(detail.discussion.sources, []);
  t.diagnostic(evidence);
});

test('PM-V12-01: stopping after an actual autonomous read preserves its partial history and does not replay the read on GET or the same request', { timeout: 60000 }, async t => {
  const root = path.resolve('.local/v12-pm01-fix/host'); await mkdir(root, { recursive: true });
  const evidence = await mkdtemp(path.join(root, 'stop-after-read-'));
  const provider = await startToolProvider(), host = await startTestHost({ dataRoot: path.join(evidence, 'host'), projectsRoot: path.join(evidence, 'projects') });
  t.after(async () => { await host.close(); await provider.close(); });
  const request = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => { const r = await host.request(route, method, body); assert.equal(r.status, status, await r.clone().text()); return r.json(); };
  await request('/api/configuration', 'PUT', { name: 'cancel after actual read', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-pm01-stop', apiKey: 'synthetic-pm01-only' });
  const { project } = await request('/api/projects', 'POST', { name: '中途停止原背景' }, 201);
  const marker = 'PM01_PARTIAL_READ_SURVIVES_STOP';
  await request(`/api/projects/${project.id}/files/upload`, 'POST', { name: '既有计划.md', directory: '020_clean', content: Buffer.from(marker).toString('base64') }, 201);
  const { discussion } = await request('/api/strategy/discussions', 'POST', { operationId: randomUUID(), projectId: project.id, sources: [] }, 201);
  let actualRead: any;
  provider.setResponder(call => {
    if (!call.recentToolResults.length) return { calls: [{ name: 'strategy_goals', arguments: { action: 'find-sources' } }] };
    const value = JSON.parse(providerMessageText(call.recentToolResults.at(-1)?.content));
    if (value.claim === 'catalog-not-read') return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-source', sourceId: value.sources[0].id } }] };
    actualRead = value; return { text: '读取完成，随后生成阶段等待用户停止。', hold: true };
  });
  const input = { requestId: randomUUID(), expectedRevision: discussion.revision, text: '在本项目背景范围自主查读，随后等待停止。' };
  await request(`/api/strategy/discussions/${discussion.id}/messages`, 'POST', input, 202);
  await provider.waitForRequests(3); assert.equal(actualRead.read.text, marker);
  await request(`/api/strategy/discussions/${discussion.id}/stop`, 'POST', { expectedRequestId: input.requestId });
  let detail: any; for (let i = 0; i < 300; i++) { detail = await request(`/api/strategy/discussions/${discussion.id}`); if (!detail.busy && detail.discussion.lastRun?.status === 'cancelled') break; await delay(20); }
  assert.equal(detail.discussion.lastRun.status, 'cancelled');
  const nativeBefore = await readFile(detail.snapshot.sessionFile), beforeRequests = provider.requests.length;
  await request(`/api/strategy/discussions/${discussion.id}/close`, 'POST', {});
  await request(`/api/strategy/discussions/${discussion.id}`); await request('/api/strategy/discussions');
  await request(`/api/strategy/discussions/${discussion.id}/messages`, 'POST', input, 202);
  assert.equal(provider.requests.length, beforeRequests); assert.deepEqual(await readFile(detail.snapshot.sessionFile), nativeBefore);
  provider.setResponder(call => { assert.ok(call.messages.some(m => providerMessageText(m.content).includes(marker)), 'explicit continuation retains the original read, rather than claiming it was forgotten'); return { text: '仅按用户新请求继续，不重读或重放旧操作。' }; });
  await request(`/api/strategy/discussions/${discussion.id}/messages`, 'POST', { requestId: randomUUID(), expectedRevision: detail.discussion.revision, text: '现明确继续，保留原背景读取与停止记录。' }, 202);
  let resumed: any; for (let i = 0; i < 300; i++) { resumed = await request(`/api/strategy/discussions/${discussion.id}`); if (!resumed.busy && resumed.discussion.lastRun?.status === 'completed') break; await delay(20); }
  assert.equal(resumed.discussion.lastRun.status, 'completed'); assert.equal(provider.requests.length, beforeRequests + 1);
  assert.deepEqual((await readFile(detail.snapshot.sessionFile)).subarray(0, nativeBefore.length), nativeBefore);
  await writeFile(path.join(evidence, 'observation.json'), JSON.stringify({ input, actualRead, stopped: detail, resumed, beforeRequests, afterRequests: provider.requests.length }, null, 2));
  t.diagnostic(evidence);
});
