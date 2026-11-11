import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { sessionEvents } from './fixtures/session-events.ts';

const report = '# 结论\nC类在本款中最大。\n如果支持窗口保持，可先做单店试点。\nA/B相对大盘更集中。\nB店四月退款下降。\n';
const basis = '对象,期间,值\n本款,C,50%\n本款,A,30%\n本款,B,20%\nB店,三月,7.1万元\nB店,四月,7.6万元\n';
const sha = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');
async function read(response: Response, expected = 200): Promise<any> { assert.equal(response.status, expected, await response.clone().text()); return response.json(); }
async function until<T>(operation: () => Promise<T>, predicate: (value: T) => boolean) {
  const deadline = Date.now() + 20_000;
  for (;;) { const value = await operation(); if (predicate(value)) return value; if (Date.now() > deadline) assert.fail('Actual review did not settle: ' + JSON.stringify(value)); await new Promise(resolve => setTimeout(resolve, 15)); }
}
const isReview = (messages: {role: string; content?: unknown}[]) => messages.some(message => ['system', 'developer'].includes(message.role) && providerMessageText(message.content).includes('conclusion-and-recommendation reviewer'));
function output(packet: any, privateOpinion?: string) {
  const data = packet.content.find((item: any) => item.id !== 'report' && item.text.includes('本款,C,50%'));
  const claims = [
    { quote: 'C类在本款中最大。', verdict: 'supported', evidenceGaps: [], conditions: ['仅限本款及所列期间。'], reason: '同一对象资料列出C为本款最高份额。', impact: '可以保留本款结构描述。' },
    { quote: '如果支持窗口保持，可先做单店试点。', verdict: 'conditional', evidenceGaps: ['试点支持窗口还需业务确认。'], conditions: ['支持窗口保持且先取得单店试点授权。'], reason: '只能保留有条件的试点建议。', impact: '当前意见不授权经营行动。' },
    { quote: 'A/B相对大盘更集中。', verdict: 'insufficient', evidenceGaps: ['缺少同口径大盘基准。'], conditions: [], reason: '本款内部占比不能推出相对大盘的集中程度。', impact: '应补基准或收窄范围。' },
    { quote: 'B店四月退款下降。', verdict: 'conflicting', evidenceGaps: [], conditions: ['同店、同口径三月与四月。'], reason: '资料中方向与原文相反；差额若需确认交回原分析。', impact: privateOpinion ?? '需要原分析Agent核查引用方向，审查侧未复算。' },
  ].map((claim, index) => ({ ...claim, id: 'claim-' + index, location: '第' + (index + 2) + '行', reportVersion: packet.report.sha256,
    evidence: data && index === 0 ? [{ materialId: data.id, locator: '本款份额记录', quote: '本款,C,50%' }] : [] }));
  return { schemaVersion: 1, reportVersion: packet.report.sha256, claims, scope: { reviewed: '四项重要主张，未执行复算。', unreviewed: ['未取得大盘定义和试点授权。'], limitations: ['只按本次实际提供范围。'] } };
}
async function fixture(t: { after(fn: () => Promise<unknown>): void }) {
  const provider = await startToolProvider(); t.after(() => provider.close());
  let host = await startTestHost(); t.after(() => host.close());
  await read(await host.request('/api/configuration', 'PUT', { name: '结论审查合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-conclusion-flow', apiKey: 'synthetic-conclusion-key' }));
  const { project } = await read(await host.request('/api/projects', 'POST', { name: '固定结论审查' }), 201);
  const { task } = await read(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '保留原会话' }), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}`, reviews = route + '/conclusion-reviews';
  await read(await host.request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: 'report.md', text: report }), 201);
  await read(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { name: 'basis.csv', directory: '020_clean', content: Buffer.from(basis).toString('base64') }), 201);
  await read(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { name: 'raw.csv', directory: '010_draw', content: Buffer.from('FORBIDDEN_RAW_MARKER').toString('base64') }), 201);
  const selection = { verificationId: randomUUID(), report: { relativePath: '060_reports/report.md', sha256: sha(report) }, basisFiles: ['020_clean/basis.csv'] };
  const preview = async (chosen = selection) => (await read(await host.request(reviews + '/preview', 'POST', chosen))).preview;
  const start = (chosen: object, etag: string) => fetch(host.baseUrl + reviews, { method: 'POST', headers: { ...host.headers, 'if-match': etag }, body: JSON.stringify(chosen) });
  return { get host() { return host; }, provider, project, task, route, reviews, selection, preview, start,
    reopen: async () => { const { dataRoot, projectsRoot } = host; await host.close(); host = await startTestHost({ dataRoot, projectsRoot }); } };
}

test('CNR-A1/A2/A3/A5: actual HTTP review fixes the old report, returns four claim opinions and atomically carries only to the original draft', { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  f.provider.setResponder(() => ({ text: '原任务保持其自身判断。' }));
  const events = await sessionEvents(f.host, f.project.id, f.task.id); t.after(() => events.close());
  await read(await f.host.request(f.route + '/messages', 'POST', { text: '这是原任务私人历史。PARENT_PRIVATE_HISTORY', requestId: randomUUID() }), 202);
  await events.terminal;
  const parent = await until(async () => {
    const response = await f.host.request(f.route); if (response.status === 409 && (await response.clone().json()).code === 'session_history_unavailable') return undefined;
    return read(response);
  }, value => value?.snapshot.status === 'idle');
  const native = await readFile(parent.task.sessionFile);
  const draft = '  保留我已有草稿及空格。\n';
  await read(await f.host.request(f.route + '/draft', 'PATCH', { text: draft }));
  const count = f.provider.requests.length;
  const candidates = await read(await f.host.request(f.reviews + '/candidates'));
  assert.equal(candidates.preselected.sha256, sha(report));
  assert.ok(candidates.reports.every((item: any) => item.relativePath.startsWith('060_reports/')));
  assert.equal(f.provider.requests.length, count);
  const preview = await f.preview();
  assert.equal((await read(await f.host.request(f.reviews))).reviews.length, 0);
  assert.equal(f.provider.requests.length, count, 'preview and candidates cannot create a review');
  let release!: () => void, packet: any;
  const held = new Promise<void>(resolve => { release = resolve; });
  f.provider.setResponder(async ({ messages, availableTools }) => {
    assert.equal(isReview(messages), true); assert.deepEqual(availableTools, []);
    packet = JSON.parse(providerMessageText(messages.filter(message => message.role === 'user').at(-1)!.content));
    assert.doesNotMatch(JSON.stringify(messages), /PARENT_PRIVATE_HISTORY|FORBIDDEN_RAW_MARKER/);
    await held; return { text: JSON.stringify(output(packet)) };
  });
  await read(await f.start(f.selection, preview.etag), 202);
  await f.provider.waitForRequests(count + 1);
  const newer = '# 后来保存的同路径新版\n这一版不在旧审查范围内。\n';
  await writeFile(path.join(f.project.rootPath, '060_reports/report.md'), newer);
  release();
  const reviewed = (await until(() => f.host.request(f.reviews + '/' + f.selection.verificationId).then(read), value => value.review.state === 'completed')).review;
  assert.equal(reviewed.reportChanged, true);
  assert.equal(reviewed.review.report.sha256, sha(report));
  assert.deepEqual(reviewed.reviewResult.output.claims.map((item: any) => item.verdict), ['supported', 'conditional', 'insufficient', 'conflicting']);
  const fixed = await read(await f.host.request(f.reviews + '/' + f.selection.verificationId + '/report'));
  assert.equal(fixed.text, report); assert.equal(fixed.sha256, sha(report));
  await read(await f.start(f.selection, preview.etag));
  assert.equal(f.provider.requests.length, count + 1, 'same accepted identity is read back without a new model');
  const carryRoute = f.reviews + '/' + f.selection.verificationId + '/carry';
  const [first, repeat] = await Promise.all([f.host.request(carryRoute, 'POST', {}).then(read), f.host.request(carryRoute, 'POST', {}).then(read)]);
  assert.equal([first, repeat].filter(value => value.appended).length, 1);
  const carried = first.appended ? first : repeat;
  assert.ok(carried.task.draft.startsWith(draft + '\n\n'));
  assert.match(carried.task.draft, /所审固定版|相对大盘|缺少同口径大盘/);
  assert.ok(carried.task.draft.includes(sha(report)));
  assert.ok(carried.task.draft.includes('020_clean/basis.csv'), 'carried evidence must resolve the material id to its fixed source path');
  assert.ok(carried.task.draft.includes(sha(basis)), 'carried evidence must preserve the exact fixed source version');
  assert.equal(f.provider.requests.length, count + 1);
  assert.deepEqual(await readFile(parent.task.sessionFile), native);
  await read(await f.host.request(f.route + '/draft', 'PATCH', { text: '' }));
  await f.reopen();
  const once = await read(await f.host.request(carryRoute, 'POST', {}));
  assert.equal(once.appended, false); assert.equal(once.task.draft, '');
  assert.equal(f.provider.requests.length, count + 1);
  assert.deepEqual(await readFile(parent.task.sessionFile), native);
  await read(await f.host.request(`/api/projects/${f.project.id}/archive`, 'POST', {}));
  assert.equal((await read(await f.host.request(f.reviews + '/' + f.selection.verificationId))).review.canCarry, false);
  assert.equal((await read(await f.host.request(f.reviews + '/' + f.selection.verificationId + '/report'))).text, report);
  await read(await f.host.request(carryRoute, 'POST', {}), 409);
  assert.equal(await readFile(path.join(f.project.rootPath, '060_reports/report.md'), 'utf8'), newer);
  assert.deepEqual(f.provider.errors, []);
});

test('CNR-A1/A5: actual source withdrawal cancels a held review and all history namespaces withhold its body', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const material = await read(await f.host.request('/api/enterprise-materials', 'POST', { title: '合成审查证据', body: 'WITHDRAWN_REVIEW_SOURCE_MARKER 适用条件待确认。' }), 201);
  const sourceRoute = '/api/enterprise-materials/' + material.material.id;
  const enabled = await read(await f.host.request(sourceRoute + '/enable', 'POST', { expectedVersion: material.material.version }));
  const selection = { ...f.selection, enterpriseMaterials: [{ storeId: enabled.storeId, materialId: enabled.material.id, revisionId: enabled.material.activeRevisionId, mode: 'full' }] };
  const preview = await f.preview(selection);
  f.provider.setResponder(({ messages, availableTools }) => {
    assert.deepEqual(availableTools, []);
    const packet = JSON.parse(providerMessageText(messages.filter(message => message.role === 'user').at(-1)!.content));
    assert.match(JSON.stringify(packet), /WITHDRAWN_REVIEW_SOURCE_MARKER/);
    return { text: JSON.stringify(output(packet, 'WITHDRAWN_OPINION_MARKER')), hold: true };
  });
  await read(await f.start(selection, preview.etag), 202);
  await f.provider.waitForRequests(1);
  await read(await f.host.request(sourceRoute + '/disable', 'POST', { expectedVersion: enabled.material.version }));
  const current = await until(() => f.host.request(f.reviews + '/' + selection.verificationId).then(read), value => value.review.sourceStatus === 'unavailable' && !['preparing','ready','running'].includes(value.review.state));
  assert.notEqual(current.review.state, 'completed');
  assert.doesNotMatch(JSON.stringify(current), /WITHDRAWN_(REVIEW_SOURCE|OPINION)_MARKER/);
  assert.equal(current.review.canCarry, false);
  assert.equal(f.provider.requests[0]!.closedEarly, true);
  const oldNamespace = await f.host.request(f.route + '/verifications/' + selection.verificationId);
  assert.notEqual(oldNamespace.status, 200);
  assert.doesNotMatch(await oldNamespace.text(), /WITHDRAWN_(REVIEW_SOURCE|OPINION)_MARKER/);
  const oldFixed = await f.host.request(f.route + '/verifications/' + selection.verificationId + '/author-file?path=060_reports/report.md');
  assert.notEqual(oldFixed.status, 200);
  const list = await read(await f.host.request(f.reviews));
  assert.equal(list.reviews[0].sourceStatus, 'unavailable');
  assert.doesNotMatch(JSON.stringify(list), /WITHDRAWN_(REVIEW_SOURCE|OPINION)_MARKER/);
  await read(await f.host.request(f.reviews + '/' + selection.verificationId + '/report'), 409);
  await read(await f.host.request(f.reviews + '/' + selection.verificationId + '/carry', 'POST', {}), 409);
  const stopped = await read(await f.host.request(f.reviews + '/' + selection.verificationId + '/stop', 'POST', {}));
  assert.equal(stopped.review.sourceStatus, 'unavailable');
  assert.equal(f.provider.requests.length, 1);
  assert.equal(await readFile(path.join(f.project.rootPath, '060_reports/report.md'), 'utf8'), report);
  assert.deepEqual(f.provider.errors, []);
});

test('CNR-A1/A3: stale preview and oversized carry preserve source, selection and draft without creating another request', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  await read(await f.host.request(f.reviews, 'POST', f.selection), 409);
  const preview = await f.preview();
  const newer = report + '\n另存前的同路径修订。\n';
  await writeFile(path.join(f.project.rootPath, '060_reports/report.md'), newer);
  const conflict = await read(await f.start(f.selection, preview.etag), 409);
  assert.equal(conflict.code, 'conclusion_review_preview_changed');
  assert.equal((await read(await f.host.request(f.reviews))).reviews.length, 0);
  assert.equal(f.provider.requests.length, 0);
  const chosen = { ...f.selection, report: { ...f.selection.report, sha256: sha(newer) } };
  const currentPreview = await f.preview(chosen);
  f.provider.setResponder(({ messages }) => ({ text: JSON.stringify(output(JSON.parse(providerMessageText(messages.filter(message => message.role === 'user').at(-1)!.content)))) }));
  await read(await f.start(chosen, currentPreview.etag), 202);
  await until(() => f.host.request(f.reviews + '/' + chosen.verificationId).then(read), value => value.review.state === 'completed');
  const originalDraft = 'x'.repeat(20_000);
  await read(await f.host.request(f.route + '/draft', 'PATCH', { text: originalDraft }));
  const carry = f.reviews + '/' + chosen.verificationId + '/carry';
  const tooLarge = await read(await f.host.request(carry, 'POST', {}), 400);
  assert.equal(tooLarge.code, 'review_draft_too_large');
  const preserved = await read(await f.host.request(f.route));
  assert.equal(preserved.task.draft, originalDraft);
  assert.ok(!preserved.task.reviewDraftIds?.includes(chosen.verificationId));
  assert.equal(preserved.task.sessionFile, undefined);
  assert.equal(f.provider.requests.length, 1);
  await read(await f.host.request(f.route + '/draft', 'PATCH', { text: '保留这个短草稿。' }));
  assert.equal((await read(await f.host.request(carry, 'POST', {}))).appended, true);
  const { task: other } = await read(await f.host.request(`/api/projects/${f.project.id}/tasks`, 'POST', { name: '另一原任务' }), 201);
  const otherRoute = `/api/projects/${f.project.id}/tasks/${other.id}`;
  await read(await f.host.request(otherRoute + '/conclusion-reviews/' + chosen.verificationId + '/carry', 'POST', {}), 404);
  assert.equal((await read(await f.host.request(otherRoute))).task.draft, '');
  assert.equal(f.provider.requests.length, 1);
  assert.equal(await readFile(path.join(f.project.rootPath, '060_reports/report.md'), 'utf8'), newer);
});
