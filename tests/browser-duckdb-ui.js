// Run only against the isolated synthetic UI with an editable input panel open.
// Position cases edit unsaved drafts. ACK cases use controlled metadata saves;
// receipt observation remains GET-only and no Agent/model is dispatched.
async (page) => {
  const panel = page.getByRole('region', { name: '数据说明与来源', exact: true });
  const mode = new URL(page.url()).searchParams.get('mode');
  if (['ack', 'ackmissing', 'ackretry'].includes(mode)) {
    if (!await page.evaluate(() => Boolean(window.__uiFixture))) throw new Error('ACK tests require the isolated synthetic HTTP-boundary fixture.');
    await panel.getByRole('textbox', { name: '解释正文', exact: true }).fill('DB05 原操作正文');
    await panel.getByRole('button', { name: '添加业务解释', exact: true }).click();
    await panel.getByRole('button', { name: '保存新说明', exact: true }).click();
    const inspect = panel.getByRole('button', { name: '核对保存状态', exact: true });
    await inspect.waitFor();
    const original = await page.evaluate(() => window.__uiCalls.find(call => call.method === 'POST' && call.path.endsWith('/descriptions'))?.body);
    const editor = panel.getByRole('textbox', { name: /解释正文 · / }), newDraft = 'DB05 新本地稿：未知保存与显式原请求重送均不得重置';
    await editor.fill(newDraft);
    if (!await panel.getByRole('button', { name: '保存新说明', exact: true }).isDisabled()) throw new Error('An unresolved original save must block a new operation without blocking local edits.');
    await inspect.click();
    await panel.getByRole('status').filter({ hasText: mode === 'ack' ? /已核到原操作/ : /状态仍为 UNKNOWN/ }).waitFor();
    if (await editor.inputValue() !== newDraft) throw new Error('Read-only receipt observation must preserve the newer draft.');
    let posts = await page.evaluate(() => window.__uiCalls.filter(call => call.method === 'POST' && call.path.endsWith('/descriptions')).map(call => call.body));
    if (posts.length !== 1) throw new Error('Receipt observation must not create a new save.');
    if (mode === 'ackretry') {
      await panel.getByRole('button', { name: '重试上次保存', exact: true }).click();
      await panel.getByRole('status').filter({ hasText: /原请求已按同一身份保存/ }).waitFor();
      posts = await page.evaluate(() => window.__uiCalls.filter(call => call.method === 'POST' && call.path.endsWith('/descriptions')).map(call => call.body));
      if (posts.length !== 2 || JSON.stringify(posts[1]) !== JSON.stringify(original)) throw new Error('Explicit retry must retain the original identity and original immutable body.');
      if (await editor.inputValue() !== newDraft) throw new Error('Successful explicit retry must preserve the newer local draft.');
    }
    if (mode === 'ackmissing' && !await inspect.isVisible()) throw new Error('Missing original operation must retain UNKNOWN and the original pending request.');
    return { mode, result: 'PASS', scope: 'public UI and synthetic HTTP only; readback sends no save/model' };
  }
  if (new URL(page.url()).searchParams.get('check') === 'markdown-rule') {
    const format = panel.getByRole('combobox', { name: '观察格式', exact: true }), coverage = panel.getByRole('combobox', { name: '观察范围', exact: true }), rule = panel.getByRole('textbox', { name: '记录计数规则', exact: true });
    await format.selectOption('markdown'); await coverage.selectOption('partial'); await rule.fill('原文 UTF-16 [12, 33) 中的表格，每条数据行是一条记录。'); await coverage.selectOption('unobserved');
    if (await rule.inputValue() !== '' || !await rule.isDisabled()) throw new Error('An unobserved Markdown document must clear and disable table record rules.');
    await format.selectOption('csv'); await coverage.selectOption('partial'); await rule.fill('CSV logical records, header excluded'); await coverage.selectOption('unobserved');
    if (await rule.inputValue() !== 'CSV logical records, header excluded' || !await rule.isEnabled()) throw new Error('The legacy CSV unobserved counting-rule behavior must remain available.');
    await format.selectOption('markdown'); if (await rule.inputValue() !== '' || !await rule.isDisabled()) throw new Error('Switching a legacy CSV unobserved rule to Markdown must clear and disable the table rule.');
    return { result: 'PASS', scope: 'Markdown/CSV public draft controls only; no save/model' };
  }
  const format = await panel.getByRole('combobox', { name: '观察格式', exact: true }).inputValue();
  if (!['xlsx', 'markdown'].includes(format)) throw new Error('Open an isolated synthetic XLSX/Markdown input first.');
  await panel.getByRole('combobox', { name: '解释内容类型', exact: true }).selectOption('field');
  const statement = `DB03_UI_EXACT_LOCATION_${format}`;
  await panel.getByRole('textbox', { name: '解释正文', exact: true }).fill(statement);
  let expected;
  if (format === 'xlsx') {
    await panel.getByRole('textbox', { name: '解释字段位置 · 工作表名称', exact: true }).fill('销售 明细');
    await panel.getByRole('textbox', { name: '解释字段位置', exact: true }).fill('C2:D4');
    expected = '工作表「销售 明细」 · C2:D4';
  } else {
    await panel.getByRole('textbox', { name: '解释字段位置 · UTF-16 起点', exact: true }).fill('5');
    await panel.getByRole('textbox', { name: '解释字段位置 · UTF-16 终点（不含）', exact: true }).fill('9');
    expected = '原文 UTF-16 [5, 9)';
  }
  await panel.getByRole('button', { name: '添加业务解释', exact: true }).click();
  // Textarea values are not text nodes: locate the exact draft by its input value.
  let found;
  for (const record of await panel.locator('.pdc-record').all()) {
    const field = record.getByRole('textbox', { name: /解释正文 ·/ });
    if (await field.count() && await field.inputValue() === statement) { found = record; break; }
  }
  if (!found || !await found.getByText(expected, { exact: true }).count()) throw new Error(`The field statement must display its exact coordinate: ${expected}`);
  await found.getByRole('button', { name: '从新稿移除', exact: true }).click();
  return { format, expected, result: 'PASS', scope: 'public UI draft only; no save/model' };
}
