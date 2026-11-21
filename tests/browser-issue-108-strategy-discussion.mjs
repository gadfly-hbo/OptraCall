// Run against an isolated, configured Host serving the stamped product UI.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.argv[2];
const uid = () => crypto.randomUUID();
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base) || [4173, 4174, 4175].includes(Number(new URL(base).port))) {
  throw new Error('Use an isolated Host');
}

async function api(path, method = 'GET', body) {
  const r = await fetch(base + path, {
    method,
    headers: { origin: base, 'x-optracall-client': '1', 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + await r.text());
  return r.json();
}

(async () => {
  const id = uid();
  const route = '/api/strategy/discussions/' + id;
  await api('/api/strategy/discussions', 'POST', {
    title: 'Issue 108 战略共创直达开聊点验',
    operationId: id,
    usageContext: { kind: 'department', background: '合成会员运营模块' },
  });

  const goalDraft = {
    title: '提高新客 90 天二购率',
    outcome: '新客 90 天二购率提升至 15%',
    perspective: 'profit',
    scope: { kind: 'personal', id: 'self', name: '个人工作' },
    measurement: { kind: 'deliverable', criterion: '核对 90 天复购统计表' },
    baseline: { state: 'known', description: '当前约 9%' },
    responsible: '会员负责人',
    strategies: ['首购后 60–90 天分层回访'],
  };
  const { goal: createdGoal } = await api('/api/strategy/goals', 'POST', { ...goalDraft, operationId: uid() });
  const detailBefore = await api(route);
  await api(route, 'PATCH', {
    expectedRevision: detailBefore.discussion.revision,
    goal: { goalId: createdGoal.goalId, version: createdGoal.version },
  });

  const nodes = [
    { id: 'G1', kind: 'goal', title: '首购后二购率', metric: '90天二购', baseline: '9%', target: '15%' },
    { id: 'S1', kind: 'strategy', title: '分层回访' },
  ];
  const review = {
    summary: '覆盖可能影响二购',
    mechanism: '再到店理由',
    condition: '可回访',
    alternative: '原意愿偏高',
    risk: '工时',
    scope: '促销周',
    test: '同店同期试验',
  };
  await api(route + '/maps', 'POST', {
    mapId: uid(),
    operationId: uid(),
    expectedVersion: 0,
    reason: '候选比较',
    draft: {
      title: '导购回访候选图',
      template: 'bsc',
      choice: '导购回访',
      nodes,
      edges: [{ id: 'e1', from: 'S1', to: 'G1', kind: 'hypothesis', review }],
    },
  });

  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.setDefaultTimeout(8000);

    await page.goto(base);
    const button = name => page.getByRole('button', { name, exact: true });
    await button('战略选择').click();

    // 1. SD01 First-time chat screen
    await page.getByText('说说你正在考虑的战略问题。可以从比较两个方向开始。', { exact: true }).waitFor();
    assert.equal(await page.getByText('本次：未设置，仍可工作').count(), 0);
    const input = page.getByLabel('战略讨论问题');
    assert.equal(await input.getAttribute('placeholder'), '下季度该优先拓新客，还是提高复购？');
    assert.equal(await button('＋ 添加资料').isVisible(), true);
    assert.equal(await button('发送讨论').isVisible(), true);

    const examplesSummary = page.locator('details.wb-methods > summary');
    assert.equal(await examplesSummary.count(), 1);
    assert.equal((await examplesSummary.innerText()).trim(), '提问示例');
    await examplesSummary.click();
    for (const label of ['复盘上期', '看看行业变化', '找机会与风险', '看看竞争压力']) {
      assert.equal(await button(label).isVisible(), true);
    }
    await input.fill('下季度该优先拓新客，还是提高复购？');
    await button('复盘上期').click();
    assert.match(await input.inputValue(), /下季度该优先拓新客，还是提高复购？\n对照上期战略、实际行动与结果/);

    // 2. SD03 Single collapsed Discussion Settings below composer
    const settingsDetails = page.locator('details.strategy-discussion-options');
    assert.equal(await settingsDetails.count(), 1);
    assert.equal(await settingsDetails.evaluate(el => el.open), false);
    await settingsDetails.locator('summary').click();
    await page.getByText('讨论用途（选填）', { exact: true }).waitFor();
    await page.getByLabel('使用用途').selectOption('department');
    assert.match(await settingsDetails.locator('summary').innerText(), /讨论设置（选填） · 已设用途：部门／业务模块/);
    await page.getByLabel('地图输出格式（选填）').selectOption('bsc');
    await page.getByRole('checkbox', { name: 'Rumelt 战略内核' }).check();

    // 3. SD02 Continue existing discussion, near-composer bindings, refresh states
    await page.locator('label').filter({ hasText: /^原讨论/ }).locator('select').selectOption(id);
    await button('刷新讨论记录').waitFor();
    await page.getByText('读取当前讨论的消息和状态，并尝试接回实时回复', { exact: true }).waitFor();
    await page.getByText('已绑定目标：目标准确版 v' + createdGoal.version).waitFor();

    await button('战略地图').click();
    await page.getByText('因果链审查', { exact: true }).click();
    await button('在原讨论审查此线').click();
    await page.getByText('围绕地图 v1 · 连线 e1').waitFor();
    await button('回到当前版本').click();
    assert.equal(await page.getByText('围绕地图 v1 · 连线 e1').count(), 0);

    const draft = '未发送草稿：刷新期间应完整保留';
    await input.fill(draft);
    await button('刷新讨论记录').click();
    await page.getByRole('status').filter({ hasText: /已刷新讨论记录/ }).waitFor();
    assert.equal(await input.inputValue(), draft);

    const eventsRoute = '**/api/strategy/discussions/' + id + '/events';
    await page.route(eventsRoute, r => r.fulfill({ status: 503, body: 'unavailable' }));
    await button('刷新讨论记录').click();
    await page.getByRole('alert').filter({ hasText: /已读取最新讨论记录，但实时回复连接尚未恢复/ }).waitFor();
    assert.equal(await input.inputValue(), draft);
    await page.unroute(eventsRoute);

    // 4. Dark mode & narrow viewport (390x844)
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await button('战略选择').click();
    await page.locator('label').filter({ hasText: /^原讨论/ }).locator('select').selectOption(id);
    assert.equal(await page.locator('.app').getAttribute('data-theme'), 'dark');
    assert.equal(await input.inputValue(), draft);

    await page.setViewportSize({ width: 390, height: 844 });
    await button('放大对话').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), '放大对话');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    assert.deepEqual(errors, []);
    console.log('PASS Issue #108 browser verification');
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
