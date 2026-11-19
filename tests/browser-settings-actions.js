// Run against the isolated UI from tests/fixtures/browser-environment.ts with its provider query parameter.
async (page) => {
  const entry = new URL(page.url());
  const provider = new URL(entry.searchParams.get('provider') || entry.origin);
  if (entry.origin !== 'http://127.0.0.1:4183' || provider.protocol !== 'http:' || provider.hostname !== '127.0.0.1' || provider.origin === entry.origin) {
    throw new Error('Use the isolated settings QA UI and its synthetic provider.');
  }
  const modelCalls = async () => (await (await page.request.get(new URL('/__qa', provider).href)).json()).requestCount;
  const before = await modelCalls();
  if (!Number.isInteger(before)) throw new Error('Missing synthetic provider receipt.');
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const appearance = button => button.evaluate(element => {
    const { backgroundColor, color, borderTopColor } = getComputedStyle(element);
    return [backgroundColor, color, borderTopColor].join(' ');
  });
  const separation = async (first, second) => {
    const a = await first.boundingBox(), b = await second.boundingBox();
    if (!a || !b) throw new Error('Both usage actions must be visible.');
    const sameRow = Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
    return { sameRow, gap: sameRow ? b.x - a.x - a.width : b.y - a.y - a.height, right: Math.max(a.x + a.width, b.x + b.width) };
  };

  await page.setViewportSize({ width: 1280, height: 880 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(entry.href);
  await page.getByRole('complementary', { name: '工作台导航', exact: true }).getByRole('button', { name: '设置', exact: true }).click();
  const tabs = page.getByRole('group', { name: '设置分类', exact: true });
  await tabs.getByRole('button', { name: '网络检索', exact: true }).click();
  const search = page.getByRole('region', { name: '搜索顺序', exact: true });
  const saveOrder = search.getByRole('button', { name: '保存顺序', exact: true });
  const restore = search.getByRole('button', { name: '恢复默认顺序', exact: true });
  await saveOrder.waitFor();
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: '切换为深色', exact: true }).click();
    check(await saveOrder.isDisabled() && await restore.isDisabled(), `${theme}: default order actions are disabled`);
    const disabled = await appearance(saveOrder);
    check(disabled === await appearance(restore), `${theme}: disabled Save and Restore use the same neutral colors`);
    await search.getByRole('button', { name: '下移 MiniMax', exact: true }).click();
    check(await saveOrder.isEnabled() && disabled !== await appearance(saveOrder), `${theme}: edited order enables a distinct Save appearance`);
    await restore.click();
    check(await saveOrder.isDisabled() && disabled === await appearance(saveOrder), `${theme}: restoring the unedited draft returns to the neutral state`);
  }

  await tabs.getByRole('button', { name: '使用用途', exact: true }).click();
  const usage = page.getByRole('region', { name: '使用用途', exact: true });
  const save = usage.getByRole('button', { name: '保存默认用途', exact: true });
  const reread = usage.getByRole('button', { name: '重新读取默认用途', exact: true });
  const kind = usage.getByLabel('使用用途', { exact: true });
  await usage.locator('select:enabled').waitFor();
  const initial = await separation(save, reread);
  check(initial.sameRow && initial.gap >= 8, 'Usage actions have a clear horizontal gap before save');
  await kind.selectOption('personal');
  await save.click();
  await usage.getByRole('status').filter({ hasText: '已保存默认用途' }).waitFor();
  const saved = await separation(save, reread);
  check(saved.sameRow && saved.gap >= 8, 'A success notice does not separate the usage action row');
  await Promise.all([
    page.waitForResponse(response => response.request().method() === 'GET' && response.url().endsWith('/api/settings/usage-context') && response.ok()),
    reread.click(),
  ]);
  check(await kind.inputValue() === 'personal', 'Reread retains the saved choice');
  await page.setViewportSize({ width: 320, height: 800 });
  const narrow = await separation(save, reread);
  check(narrow.gap >= 8 && narrow.right <= 321, 'Usage actions stay separated and within a narrow viewport');
  check(await modelCalls() === before, 'Settings checks do not call the model');
  if (failures.length) throw new Error(failures.join('\n'));
  return { initial, saved, narrow };
}
