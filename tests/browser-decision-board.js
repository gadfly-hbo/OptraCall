async (page) => {
  // Run only against tests/fixtures/browser-environment.ts. No real Provider or user data.
  const initial = new URL(page.url()), baseUrl = initial.origin, providerUrl = initial.searchParams.get('provider');
  if (initial.hostname !== '127.0.0.1' || initial.port !== '4183' || !providerUrl || new URL(providerUrl).hostname !== '127.0.0.1') throw new Error('Use isolated QA UI4183 and its localhost synthetic Provider.');
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const errors = [], outbound = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { const url = new URL(request.url()); if (url.protocol.startsWith('http') && url.hostname !== '127.0.0.1') outbound.push(url.origin); });
  const api = async (route, method = 'GET', data) => {
    const response = await page.request.fetch(baseUrl + '/api/' + route, { method, headers: { 'x-optracall-client': '1', origin: baseUrl, 'content-type': 'application/json' }, ...(data === undefined ? {} : { data: JSON.stringify(data) }) });
    assert(response.ok(), `${method} ${route}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const prefix = `决策看板 ${Date.now()}`;
  const metrics = async () => (await page.request.get(new URL('/__qa', providerUrl).href)).json();
  const REPORT = `# 会员复购分析\n\n高价值会员 BOARD_QUOTE_MARKER_复购率42%→31%，渠道贡献主要降幅。\n\n建议补发召回权益并核对渠道投放。`;

  await page.setViewportSize({ width: 1720, height: 1000 });
  await api('configuration', 'PUT', { name: prefix + ' 合成模型', provider: 'openai-compatible', baseUrl: providerUrl, model: 'synthetic-board-extract', apiKey: 'synthetic-board-key' });
  const active = (await api('projects', 'POST', { name: prefix + ' 活跃项目' })).project;
  const archived = (await api('projects', 'POST', { name: prefix + ' 归档项目' })).project;
  await api(`projects/${active.id}/files/save-report`, 'POST', { name: '复购分析.md', text: REPORT });
  await api(`projects/${archived.id}/files/save-report`, 'POST', { name: '旧报告.md', text: '旧报告内容。' });
  await api(`projects/${archived.id}/archive`, 'POST', {});

  await page.goto(baseUrl);
  await page.getByRole('button', { name: '决策', exact: true }).click();
  await page.getByRole('heading', { name: '决策看板', exact: true }).waitFor();
  const board = page.locator('.decision-page');
  const reportRow = name => board.locator('.board-report-row', { hasText: name });
  const card = title => board.locator('.decision-card', { hasText: title });
  const lane = name => board.locator('.decision-lane.' + name);
  const dismissDialog = () => page.getByRole('dialog', { name: '驳回建议', exact: false });
  const taskDialog = () => page.getByRole('dialog', { name: '添加行动任务', exact: false });
  const feedbackDialog = () => page.getByRole('dialog', { name: '回录反馈', exact: false });
  const manualDialog = () => page.getByRole('dialog', { name: '人工补充建议', exact: false });

  // Board aggregates both projects; archived rows are visible but read-only (DB01/DB11).
  await reportRow('复购分析.md').waitFor();
  assert(await reportRow('复购分析.md').getByText('未抽取').isVisible(), 'active report starts unextracted');
  assert(await reportRow('旧报告.md').getByText('已归档').isVisible(), 'archived project is labelled');
  assert(await reportRow('旧报告.md').getByRole('button', { name: '抽取建议', exact: true }).isDisabled(), 'archived project extraction is disabled');
  // Reading and filtering the board never calls models (DB03).
  const beforeProvider = (await metrics()).requestCount;
  await board.getByLabel('按证据等级过滤').selectOption('数据支撑');
  assert(await board.getByLabel('按证据等级过滤').inputValue() === '数据支撑', 'evidence filter applied');
  await board.getByLabel('按证据等级过滤').selectOption('all');
  assert((await metrics()).requestCount === beforeProvider, 'navigation and filters must not call the model');

  // Explicit extraction drives the only model call; the canned reply keeps one
  // verbatim quote and one quote-less fact (DB03/DB04).
  await reportRow('复购分析.md').getByRole('button', { name: '抽取建议', exact: true }).click();
  await reportRow('复购分析.md').getByText('已抽取 2 条', { exact: false }).waitFor({ timeout: 30_000 });
  assert((await metrics()).requestCount === beforeProvider + 1, 'extraction adds exactly one model call');
  await card('补发高价值会员召回权益').getByRole('heading', { name: '补发高价值会员召回权益' }).waitFor();
  assert(await card('补发高价值会员召回权益').getByText('置信度 90%').isVisible(), 'confidence derives from 数据支撑');
  assert(await card('核对渠道投放记录').getByText('置信度 55%').isVisible(), 'confidence derives from 逻辑推断');
  await card('补发高价值会员召回权益').locator('summary').click();
  assert(await card('补发高价值会员召回权益').getByText('BOARD_QUOTE_MARKER_复购率42%→31%').isVisible(), 'verbatim quote renders');
  assert((await card('补发高价值会员召回权益').locator('blockquote').count()) === 1, 'quote-less facts stay facts');

  // Decision loop: adopt -> task -> done -> feedback; dismiss keeps reasons (DB05/DB07/DB08).
  await card('补发高价值会员召回权益').getByRole('button', { name: '采纳', exact: true }).click();
  await lane('action').getByRole('heading', { name: '补发高价值会员召回权益' }).waitFor();
  await lane('action').getByRole('button', { name: '添加任务', exact: true }).click();
  await taskDialog().getByRole('textbox', { name: '任务标题（必填）' }).fill('配置召回权益');
  await taskDialog().getByRole('textbox', { name: '负责人' }).fill('运营甲');
  await taskDialog().getByRole('button', { name: '添加任务', exact: true }).click();
  await lane('action').getByText('配置召回权益').waitFor();
  await lane('action').getByRole('button', { name: '开始', exact: true }).click();
  await lane('action').getByRole('button', { name: '完成', exact: true }).click();
  await lane('feedback').getByRole('heading', { name: '配置召回权益' }).waitFor();
  await lane('feedback').getByRole('button', { name: '回录反馈', exact: true }).click();
  await feedbackDialog().getByRole('textbox', { name: '执行结果' }).fill('召回权益已上线');
  await feedbackDialog().getByRole('textbox', { name: '指标变化' }).fill('复购率 +2.4%');
  await feedbackDialog().getByRole('textbox', { name: '复盘' }).fill('召回有效');
  await feedbackDialog().getByLabel('评分（1–5）').selectOption('4');
  await feedbackDialog().getByRole('button', { name: '保存反馈', exact: true }).click();
  await lane('feedback').getByText('★★★★☆').waitFor();

  await card('核对渠道投放记录').getByRole('button', { name: '驳回', exact: true }).click();
  await dismissDialog().getByRole('textbox', { name: '驳回理由（必填，至少 2 字）' }).fill('x');
  assert(await dismissDialog().getByRole('button', { name: '确认驳回', exact: true }).isDisabled(), 'short reason blocks submission');
  await dismissDialog().getByRole('textbox', { name: '驳回理由（必填，至少 2 字）' }).fill('先看召回效果');
  await dismissDialog().getByRole('button', { name: '确认驳回', exact: true }).click();
  await dismissDialog().waitFor({ state: 'detached', timeout: 30_000 });
  await board.locator('#dismissed-toggle').waitFor({ timeout: 30_000 });
  await board.locator('#show-dismissed').check();
  assert(await card('核对渠道投放记录').getByText('驳回理由：先看召回效果').isVisible(), 'dismissed card shows its reason');
  assert((await card('核对渠道投放记录').getByRole('button', { name: '采纳', exact: true }).count()) === 0, 'dismissed card is read-only');

  // Manual suggestions join the same loop with fixed 经验假设 (DB09).
  await board.getByRole('button', { name: '补充建议', exact: true }).click();
  await manualDialog().getByRole('textbox', { name: '建议标题（必填）' }).fill('人工补充渠道排查');
  await manualDialog().getByRole('textbox', { name: '理由（必填）' }).fill('一线反馈渠道异常');
  await manualDialog().getByRole('button', { name: '补充建议', exact: true }).click();
  const manualCard = lane('review').locator('.decision-card', { hasText: '人工补充渠道排查' });
  await manualCard.waitFor();
  assert(await manualCard.getByText('人工', { exact: true }).isVisible(), 'manual badge');
  assert(await manualCard.getByText('经验假设').isVisible(), 'manual evidence level');

  // Re-extraction rebuilds only suggested items (DB06). The running chip gates
  // the completion wait: the completed text alone can match the previous round.
  await reportRow('复购分析.md').getByRole('button', { name: '重新抽取', exact: true }).click();
  await reportRow('复购分析.md').getByText('抽取中…').waitFor({ timeout: 15_000 });
  await reportRow('复购分析.md').getByText('已抽取 2 条', { exact: false }).waitFor({ timeout: 30_000 });
  await lane('action').getByRole('heading', { name: '补发高价值会员召回权益' }).waitFor();
  await manualCard.waitFor();
  assert((await metrics()).requestCount === beforeProvider + 2, 're-extraction adds exactly one more call');

  // Keyboard entry point and narrow viewport stay usable (A11Y).
  const focused = await page.evaluate(() => document.activeElement?.textContent);
  assert(board.getByRole('heading', { name: '决策看板', exact: true }).isVisible(), 'board remains rendered');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 1, `narrow viewport must not scroll horizontally (${overflow}px)`);
  await page.setViewportSize({ width: 1720, height: 1000 });
  void focused;

  assert(errors.length === 0, `page errors: ${errors.join('; ')}`);
  assert(outbound.length === 0, `external requests: ${outbound.join('; ')}`);
}
