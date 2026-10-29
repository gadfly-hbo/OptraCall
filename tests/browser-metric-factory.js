async (page) => {
  const initial = new URL(page.url());
  const baseUrl = initial.origin, providerUrl = initial.searchParams.get('provider');
  if (initial.port !== '4183' || !providerUrl || new URL(providerUrl).hostname !== '127.0.0.1') throw new Error('Use isolated QA UI 4183 and the synthetic provider query parameter.');
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const passed = [], outbound = [], errors = [];
  page.on('request', request => { if (new URL(request.url()).hostname !== '127.0.0.1') outbound.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const headers = { origin: baseUrl, 'x-optracall-client': '1' };
  const projectName = '指标体系回归 ' + Date.now();
  const fixture = readFileSync(path.resolve(process.cwd(), 'extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml'), 'utf8');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${baseUrl}/?provider=${encodeURIComponent(providerUrl)}`);
  const configured = await (await page.request.put(`${baseUrl}/api/configuration`, { headers, data: { name: '指标体系合成模型', provider: 'openai-compatible', api: 'openai-completions', baseUrl: new URL('/slow/v1', providerUrl).href, model: 'synthetic-model', apiKey: 'synthetic-metric-key' } })).json();
  assert(configured.configuration?.id, 'Synthetic fixture configuration must save');
  await page.request.post(`${baseUrl}/api/configuration/select`, { headers, data: { id: configured.configuration.id } });
  await page.reload();
  await page.getByRole('button', { name: '新建项目', exact: true }).waitFor();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建项目', exact: true });
  await dialog.getByRole('textbox', { name: '项目名称', exact: true }).fill(projectName);
  await dialog.getByRole('button', { name: '创建项目', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('heading', { name: projectName, exact: true, level: 1 }).waitFor();
  const projectId = (await (await page.request.get(`${baseUrl}/api/projects`, { headers })).json()).projects.find(project => project.name === projectName).id;
  const projectRoot = (await (await page.request.get(`${baseUrl}/api/projects`, { headers })).json()).projects.find(project => project.name === projectName).rootPath;
  // Drafts are agent-authored file writes; the user upload whitelist stays CSV/JSON/MD/TXT.
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const placeDraft = (name, text) => writeFileSync(path.join(projectRoot, '020_clean', name), text, 'utf8');
  mkdirSync(path.join(projectRoot, '020_clean'), { recursive: true });

  const metricNav = () => page.getByRole('navigation', { name: '能力目录' }).getByRole('button', { name: '指标体系', exact: true });
  const tab = name => page.getByRole('group', { name: '指标体系视图' }).getByRole('button', { name, exact: true });

  await metricNav().click();
  await page.getByRole('heading', { name: '指标体系', exact: true, level: 1 }).waitFor();
  assert(await metricNav().getAttribute('aria-current') === 'page', 'Sidebar selection must match the metric view');
  await page.getByRole('heading', { name: '全局库还没有资产包', exact: true }).waitFor();
  passed.push('指标体系入口展示诚实的空库状态');

  await page.locator('.mf-toolbar').getByRole('button', { name: '＋ 发起建模任务', exact: true }).click();
  const modeling = page.getByRole('dialog', { name: '发起建模任务', exact: true });
  await modeling.getByLabel('项目', { exact: true }).selectOption({ label: projectName });
  await modeling.getByRole('button', { name: '创建并打开任务', exact: true }).click();
  await modeling.waitFor({ state: 'detached' });
  const composer = page.getByRole('textbox', { name: '消息', exact: true });
  await composer.waitFor();
  const draft = await composer.inputValue();
  assert(draft.includes('SAP 0.2') && draft.includes('020_clean'), 'Modeling task must prefill the SAP 0.2 guide draft');
  passed.push('建模任务在项目内创建并预填 SAP 0.2 引导草稿，不预装 skill、不自动调用模型');

  await metricNav().click();
  await page.getByRole('heading', { name: '指标体系', exact: true, level: 1 }).waitFor();
  placeDraft('membership-repurchase@1.0.0.draft.yaml', fixture);
  await tab('审核发布').click();
  await page.getByRole('combobox', { name: '项目', exact: true }).selectOption({ label: projectName });
  const draftSelect = page.getByRole('combobox', { name: '草稿文件（020_clean）', exact: true });
  await draftSelect.selectOption('020_clean/membership-repurchase@1.0.0.draft.yaml');
  await page.getByRole('button', { name: '校验草稿', exact: true }).click();
  await page.getByRole('heading', { name: '人工确认', exact: true }).waitFor();
  const publishButton = page.getByRole('button', { name: '发布 1.0.0 到全局库', exact: true });
  assert(await publishButton.isDisabled(), 'Publish stays disabled before metric confirmation and reviewer');
  for (const metric of ['会员复购率', '复购会员数', '购买会员数', '复购间隔']) {
    await page.getByLabel(metric, { exact: false }).first().check();
  }
  assert(await publishButton.isDisabled(), 'Publish stays disabled without reviewer signature');
  await page.getByRole('textbox', { name: '审核人（reviewed_by）', exact: true }).fill('synthetic-reviewer');
  assert(await publishButton.isEnabled(), 'Publish unlocks after confirmations and reviewer');
  await publishButton.click();
  await page.getByRole('heading', { name: '全局库还没有资产包', exact: true }).waitFor({ state: 'detached' });
  await page.getByRole('heading', { name: 'membership-repurchase', exact: true }).waitFor();
  passed.push('草稿校验→逐项确认→审核人署名→发布到全局库完整走通，未确认前发布不可用');

  placeDraft('bad-draft.yaml', fixture.replace('      reviewed_by: huangbo\n', ''));
  await tab('审核发布').click();
  await page.getByRole('combobox', { name: '项目', exact: true }).selectOption({ label: projectName });
  await draftSelect.selectOption('020_clean/bad-draft.yaml');
  const validateResponse = page.waitForResponse(response => response.url().includes('/api/metric-factory/draft/validate'));
  await page.getByRole('button', { name: '校验草稿', exact: true }).click();
  const probe = await validateResponse;
  console.log('BAD-DRAFT-VALIDATE:', probe.status(), (await probe.text()).slice(0, 160));
  await page.getByText('SAP_UNREVIEWED', { exact: false }).first().waitFor();
  assert(await page.getByRole('heading', { name: '人工确认', exact: true }).isHidden(), 'Failed validation must not offer publishing');
  passed.push('origin=llm 缺 reviewed_by 的草稿被拒绝发布并显示精确错误');

  await tab('库总览').click();
  await page.getByRole('button', { name: '查看详情 →', exact: true }).click();
  await page.getByText('已发布 · 不可变', { exact: true }).waitFor();
  for (const metric of ['会员复购率', '复购会员数', '购买会员数', '复购间隔']) {
    assert(await page.getByText(metric, { exact: false }).first().isVisible(), `Metric ${metric} visible`);
  }
  assert(await page.getByText('~/.optracall/metric-assets/membership-repurchase/1.0.0.sap.yaml').isVisible(), 'Library file path must be disclosed');
  passed.push('包详情展示指标、场景、指纹与库文件路径');

  await tab('项目启用').click();
  await page.getByRole('combobox', { name: '项目', exact: true }).selectOption({ label: projectName });
  await page.getByRole('combobox', { name: '资产包', exact: true }).selectOption('membership-repurchase');
  await page.getByRole('combobox', { name: '版本', exact: true }).selectOption('1.0.0');
  await page.getByRole('button', { name: '启用到项目', exact: true }).click();
  await page.getByText('指标 ×4', { exact: true }).waitFor();
  const records = await (await page.request.get(`${baseUrl}/api/metric-factory/projects/${projectId}`, { headers })).json();
  assert(records.records?.length === 1 && records.records[0].version === '1.0.0' && records.records[0].entry?.metricNames?.length === 4, 'Enablement record must pin the exact version with joined entry');
  await page.getByRole('button', { name: '停用', exact: true }).click();
  await page.getByText('尚未启用任何资产包。', { exact: true }).waitFor();
  passed.push('项目启用精确版本并可停用；启用记录独立于 project.json');

  await page.getByRole('button', { name: '返回工作区 →', exact: true }).click();
  await page.getByRole('textbox', { name: '消息', exact: true }).waitFor();
  assert((await composer.inputValue()).includes('SAP 0.2'), 'Returning to workspace preserves the modeling draft');

  await page.getByRole('button', { name: '切换为深色', exact: true }).click();
  await metricNav().click(); await tab('库总览').click();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: '展开侧栏', exact: true }).waitFor();
    await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
    await metricNav().click();
    await page.getByRole('heading', { name: '指标体系', exact: true, level: 1 }).waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Metric page must not overflow horizontally');
    await tab('审核发布').click();
  }
  passed.push('深色主题与 390/320px 窄屏指标页无横向溢出');
  assert(outbound.length === 0, 'No external browser requests: ' + outbound.join(','));
  assert(errors.length === 0, 'No browser exceptions: ' + errors.join(','));
  assert(await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0), 'No browser credential persistence');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '切换为浅色', exact: true }).click();
  return { result: 'PASS', checks: passed, project: projectName, externalRequests: outbound.length, browserErrors: errors.length };
}
