// Targeted post-review revalidation only. Preserve the original main-flow test.
// Start an isolated QA UI4183 and the retained review-fix fixture helper first;
// open /?fixture=<loopback fixture JSON URL>&phase=basics or phase=status.
async (page) => {
  const initial = new URL(page.url()), origin = initial.origin;
  const fixtureUrl = initial.searchParams.get('fixture'), phase = initial.searchParams.get('phase') || 'basics';
  const assert = (value, message) => { if (!value) throw new Error(message); };
  assert(origin === 'http://127.0.0.1:4183' && fixtureUrl && new URL(fixtureUrl).hostname === '127.0.0.1', 'Use isolated UI4183 with an owned loopback synthetic fixture');
  const f = await (await page.request.get(fixtureUrl)).json();
  assert(f.project.rootPath.includes('optracall-host-test-'), 'Fixture must belong to the isolated synthetic Host');
  const base = `/api/projects/${f.project.id}/data-context`;
  const api = async (route, method = 'GET', data, status = 200) => {
    const response = await page.request.fetch(origin + route, { method, headers: { origin, 'x-optracall-client': '1' }, ...(data === undefined ? {} : { data }) });
    assert(response.status() === status, `${method} ${route}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const metrics = async () => (await page.request.get(new URL('/__qa', f.provider).href)).json();
  const errors = [], descriptionWrites = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`${base}/descriptions`)) descriptionWrites.push(request.postDataJSON()); });
  const before = (await metrics()).requestCount;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/?project=${f.project.id}&task=${f.task.id}`);
  await page.getByRole('heading', { name: f.task.name, exact: true, level: 1 }).waitFor();
  const files = page.getByRole('complementary', { name: '项目文件', exact: true });
  if (!await files.isVisible()) await page.getByRole('button', { name: '展开项目文件', exact: true }).click();
  await files.getByRole('button', { name: '数据说明与来源 review-sales.csv', exact: true }).click();
  const panel = page.getByRole('region', { name: '数据说明与来源', exact: true });
  await panel.getByRole('heading', { name: '数据说明与来源', exact: true }).waitFor();
  // The external CAS fixture deliberately created a newer input without an
  // explanation. Historical mapping checks explicitly select the old input.
  if (phase === 'status') await panel.getByRole('combobox', { name: '固定输入版本', exact: true }).selectOption(f.input.inputVersionId);
  const sources = panel.getByRole('region', { name: '字段与精确来源', exact: true });
  await sources.getByRole('button', { name: '读取概念说明', exact: true }).first().waitFor();
  const checks = [];
  if (phase === 'basics') {
    const statement = panel.getByRole('textbox', { name: `解释正文 · ${f.description.statements[0].statementId.slice(0, 8)}`, exact: true });
    const draft = 'M2_REVIEW_CAS_DRAFT_MUST_SURVIVE_409_AND_REFRESH';
    await statement.fill(draft);
    const concurrentId = await page.evaluate(() => crypto.randomUUID());
    await api(`${base}/inputs`, 'POST', { ...f.input, operationId: concurrentId, inputVersionId: concurrentId, baseIndexRevision: 2 }, 201);
    const failedResponse = page.waitForResponse(response => response.url().endsWith(`${base}/descriptions`) && response.request().method() === 'POST');
    await panel.getByRole('button', { name: '保存新说明', exact: true }).click();
    const failed = await failedResponse;
    assert(failed.status() === 409, `Stale editor must fail CAS: ${failed.status()} ${await failed.text()}`);
    const originalPending = failed.request().postDataJSON();
    assert(originalPending.baseIndexRevision === 2 && originalPending.statements[0].text === draft, 'The rejected request is the precise original draft and base');
    assert(await statement.inputValue() === draft, '409 must preserve the editable draft');
    const writesBeforeRefresh = descriptionWrites.length;
    const refresh = page.waitForResponse(response => response.url().endsWith(base) && response.request().method() === 'GET');
    await panel.getByRole('button', { name: '保留草稿刷新版本', exact: true }).click(); await refresh;
    await panel.getByRole('status').filter({ hasText: '已刷新项目版本，当前草稿与原保存请求保留' }).waitFor();
    assert(await statement.inputValue() === draft, 'Refresh cannot replace the draft with a current pointer');
    assert(descriptionWrites.length === writesBeforeRefresh, 'Refresh cannot mutate or automatically send the old pending request');
    const retriedResponse = page.waitForResponse(response => response.url().endsWith(`${base}/descriptions`) && response.request().method() === 'POST');
    await panel.getByRole('button', { name: '重试上次保存', exact: true }).click();
    const retried = await retriedResponse;
    assert(retried.status() === 409, 'An explicit old-pending retry keeps its stale base and cannot silently rebase');
    assert(JSON.stringify(retried.request().postDataJSON()) === JSON.stringify(originalPending), 'Old pending retry must preserve every original field and identity');
    assert(await statement.inputValue() === draft, 'Explicit failed retry still preserves the draft');
    const newResponse = page.waitForResponse(response => response.url().endsWith(`${base}/descriptions`) && response.request().method() === 'POST');
    await panel.getByRole('button', { name: '保存新说明', exact: true }).click();
    const saved = await newResponse;
    assert(saved.status() === 201, `Explicit new save must use fresh base: ${saved.status()} ${await saved.text()}`);
    const newInput = saved.request().postDataJSON(), record = (await saved.json()).record;
    assert(newInput.operationId !== originalPending.operationId && newInput.baseIndexRevision === 3, 'Only a new explicit save creates a new identity against the refreshed index');
    assert(record.statements[0].text === draft, 'Saved new revision retains the actual edited text');
    checks.push('A: stale409, draft-preserving refresh, exact old-pending retry, explicit newID/freshbase save');

    const keptDraft = 'M2_REVIEW_VALID_DRAFT_BEFORE_MALFORMED_IMPORT';
    await statement.fill(keptDraft);
    const evidenceBefore = await panel.locator('.pdc-observation-evidence').first().innerText();
    assert(evidenceBefore.includes('2026') && evidenceBefore.includes('原生执行证据未记录') && evidenceBefore.includes('020_clean/review-observation.json') && evidenceBefore.includes(f.description.observation.artifactEvidence.sha256), 'C: generation time, absent native proof and exact artifact evidence must be visible');
    await panel.locator('summary').filter({ hasText: '字段观察与产物导入' }).click();
    await panel.getByLabel('导入观察文件', { exact: true }).setInputFiles({ name: 'malformed-observation.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...f.description.observation, fields: [null] })) });
    await panel.getByRole('alert').filter({ hasText: /观察文件|格式/ }).waitFor();
    assert(await statement.inputValue() === keptDraft, 'Malformed fields:[null] import must preserve the legal explanation draft');
    assert(await panel.locator('.pdc-observation-evidence').first().innerText() === evidenceBefore, 'Malformed import cannot replace the previously valid observation evidence');
    assert(errors.length === 0, `Malformed import cannot white-screen or throw: ${errors.join(', ')}`);
    checks.push('B/C: fields:[null] rejected without page error, original draft and timestamp/native/artifact disclosure retained');
    await page.getByLabel(`项目操作 ${f.project.name}`, { exact: true }).click();
    await page.getByRole('button', { name: '归档项目', exact: true }).click();
    await page.getByText('项目已归档，当前为只读查看。', { exact: true }).waitFor();
    if (!await panel.isVisible()) {
      if (!await files.isVisible()) await page.getByRole('button', { name: '展开项目文件', exact: true }).click();
      await files.getByRole('button', { name: '数据说明与来源 review-sales.csv', exact: true }).click();
    }
    const conceptRead = sources.getByRole('button', { name: '读取概念说明', exact: true }).first(), sapRead = sources.getByRole('button', { name: '读取 SAP 口径', exact: true });
    assert(!await conceptRead.isDisabled() && !await sapRead.isDisabled(), 'Archived mapping exact reads must remain available');
    await conceptRead.click();
    await panel.getByRole('heading', { name: '概念说明精确修订', exact: true }).waitFor();
    assert((await panel.locator('pre').innerText()).includes('M2_REVIEW_AVAILABLE_EXACT_BODY'), 'Archive concept read must return the precise healthy revision');
    await sapRead.click();
    await panel.getByRole('heading', { name: 'SAP 精确指标定义', exact: true }).waitFor();
    assert((await panel.locator('pre').innerText()).includes('repurchase_rate'), 'Archive SAP read must return the precise existing metric definition');
    assert(await sources.getByRole('textbox', { name: `争议或限制 · ${f.description.mappings[0].mappingId.slice(0, 8)}`, exact: true }).isDisabled(), 'Archived mapping editing remains disabled');
    assert(await sources.getByRole('checkbox', { name: '本次确认此映射', exact: true }).isDisabled(), 'Archived confirmation remains disabled');
    assert(await panel.getByRole('button', { name: '保存新说明', exact: true }).count() === 0, 'Archive exposes no new description-save action');
    await page.screenshot({ path: 'output/playwright/m2/review-fix-archive-exact-read.png' });
    checks.push('D: archive exact concept/SAP reads succeed while editing and confirmation stay disabled');
  } else {
    assert(phase === 'status', 'Only the defined targeted phases are supported');
    const statusResponse = page.waitForResponse(response => response.url().endsWith(`${base}/source-status`) && response.request().method() === 'POST');
    await sources.getByRole('button', { name: '核对这些来源当前状态', exact: true }).click();
    const checked = await statusResponse;
    assert(checked.status() === 200, 'Archived exact source-state projection is read-only and available');
    const status = await checked.json();
    const expected = { available: 'available', disabled: 'disabled', missing: 'missing', corrupt: 'corrupt' };
    for (const material of f.materials) assert(status.concepts.find(item => item.ref.revisionId === material.ref.revisionId)?.status === expected[material.label], `Exact ${material.label} source status must come from its authority`);
    const shown = await sources.innerText();
    for (const label of ['可读取', '已停用', '缺失', '损坏']) assert(shown.includes(label), `Current source state must be visible: ${label}`);
    assert(status.metrics[0].status === 'available', 'The unchanged precise SAP publication stays available');
    assert((await api(base)).datasets[0].descriptions.some(item => item.descriptionRevisionId === f.description.descriptionRevisionId), 'Current status checks must retain original historical refs');
    await page.screenshot({ path: 'output/playwright/m2/review-fix-source-states.png' });
    checks.push('E: explicit archived source check visibly distinguishes available/disabled/missing/corrupt; old refs remain');
  }
  assert(errors.length === 0, `Browser exceptions: ${errors.join(', ')}`);
  assert((await metrics()).requestCount === before, 'Review-fix history/edit/validation checks cannot invoke a model');
  return { result: 'PASS', phase, projectId: f.project.id, taskId: f.task.id, checks, providerRequestsAdded: 0 };
}
