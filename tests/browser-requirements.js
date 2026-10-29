async (page) => {
  const initial = new URL(page.url());
  const baseUrl = initial.origin, providerUrl = initial.searchParams.get('provider');
  if (initial.port !== '4183' || !providerUrl || new URL(providerUrl).hostname !== '127.0.0.1') throw new Error('Use isolated QA UI 4183 and the synthetic provider query parameter.');
  const passed = [], outbound = [], errors = [];
  page.on('request', request => { if (new URL(request.url()).hostname !== '127.0.0.1') outbound.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const headers = { origin: baseUrl, 'x-optracall-client': '1' };
  const instanceTitle = '需求梳理回归 ' + Date.now();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${baseUrl}/?provider=${encodeURIComponent(providerUrl)}`);
  const configured = await (await page.request.put(`${baseUrl}/api/configuration`, { headers, data: { name: '需求梳理合成模型', provider: 'openai-compatible', api: 'openai-completions', baseUrl: providerUrl, model: 'synthetic-model', apiKey: 'synthetic-requirement-key' } })).json();
  assert(configured.configuration?.id, 'Synthetic fixture configuration must save');
  await page.request.post(`${baseUrl}/api/configuration/select`, { headers, data: { id: configured.configuration.id } });
  await page.reload();
  await page.getByRole('button', { name: '新建项目', exact: true }).waitFor();

  const nav = () => page.getByRole('navigation', { name: '能力目录' }).getByRole('button', { name: '需求梳理', exact: true });
  await nav().click();
  await page.getByRole('heading', { name: '需求梳理', exact: true, level: 1 }).waitFor();
  assert(await nav().getAttribute('aria-current') === 'page', 'Sidebar selection must match the requirement view');
  passed.push('nav-entry');

  await page.getByRole('button', { name: '创建并进入工作台', exact: true }).waitFor();
  await page.getByLabel('需求名称', { exact: false }).or(page.locator('.re-create-row input')).first().fill(instanceTitle);
  await page.getByRole('button', { name: '创建并进入工作台', exact: true }).click();
  await page.getByRole('heading', { name: instanceTitle, exact: true, level: 1 }).waitFor();
  passed.push('create-instance');

  // Stage 01: free navigation works both ways without any gating.
  await page.getByRole('button', { name: /STAGE 04/ }).click();
  await page.getByRole('group', { name: '阶段（自由跳转）' }).waitFor();
  const blocked = await page.getByRole('button', { name: /发布被结构完整性阻断/ }).isEnabled();
  assert(blocked, 'Publish must be blocked only by structural completeness');
  passed.push('free-jump-and-blocked-publish');

  await page.getByRole('button', { name: /STAGE 01/ }).click();
  const goal = page.locator('.re-field', { hasText: '核心目标' }).locator('textarea');
  await goal.fill('定位30天复购率下滑主驱动因素');
  await page.getByRole('button', { name: '保存四要素', exact: true }).click();
  await page.getByRole('button', { name: '确认成正式需求', exact: true }).waitFor();
  passed.push('stage1-save');

  await page.getByRole('button', { name: /STAGE 02/ }).click();
  await page.getByRole('button', { name: /确认成正式需求|重新确认/ }).click();
  await page.getByText(/已生成不可变确认快照|重新确认/).first().waitFor();
  passed.push('stage2-confirm');

  await page.getByRole('button', { name: /STAGE 03/ }).click();
  const generate = page.getByRole('button', { name: '生成框架', exact: true });
  assert(await generate.isEnabled(), 'Framework generation requires the fresh snapshot from Stage 02');
  await generate.click();
  await page.getByText(/无法解析为 JSON|未完成/).first().waitFor({ timeout: 30_000 });
  passed.push('generate-graceful-failure');

  await page.getByRole('button', { name: /STAGE 04/ }).click();
  assert(await page.getByText('结构完整性 · 发布时硬校验').isVisible(), 'Three-tier gate list renders');
  assert(await page.getByText('一致性 · 警告，不阻断').isVisible(), 'Warn tier renders without blocking');
  assert(await page.getByText('业务完备性 · 提示，不阻断').isVisible(), 'Info tier renders without blocking');
  passed.push('stage4-tiers');

  if (outbound.length) throw new Error(`Unexpected outbound requests: ${outbound.join(', ')}`);
  if (errors.length) throw new Error(`Page errors: ${errors.join(', ')}`);
  return { passed };
}
