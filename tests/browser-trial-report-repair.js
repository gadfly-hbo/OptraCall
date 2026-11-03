async (page, { artifactDir = '.local/trial-repair-20261103/browser', target } = {}) => {
  const initial = new URL(page.url()), baseUrl = initial.origin, providerUrl = initial.searchParams.get('provider');
  if (initial.port !== '4183' || !providerUrl || new URL(providerUrl).hostname !== '127.0.0.1') throw new Error('Only isolated UI 4183 and an explicit synthetic localhost Provider are allowed.');
  const checks = [], errors = [], outbound = [], uploads = [];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const metrics = async () => (await page.request.get(new URL('/__qa', providerUrl).href)).json();
  const files = () => page.getByRole('complementary', { name: '项目文件', exact: true });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { const url = new URL(request.url()); if (url.protocol.startsWith('http') && url.hostname !== '127.0.0.1') outbound.push(url.origin); });
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/files/upload')) uploads.push(request.url()); });
  await page.goto(baseUrl);
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.getByLabel('模型配置', { exact: true }).selectOption('custom-new');
  await page.getByRole('textbox', { name: /配置名称/ }).fill('试用修复合成模型');
  await page.getByRole('textbox', { name: /服务地址/ }).fill(providerUrl);
  await page.getByRole('textbox', { name: /模型名称/ }).fill('synthetic-model');
  await page.getByLabel(/API Key/).fill('synthetic-trial-repair-only');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '配置已保存到本机' }).waitFor();
  await page.getByRole('button', { name: '返回Case看板', exact: true }).click();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  const projectDialog = page.getByRole('dialog', { name: '新建项目', exact: true });
  const projectName = '试用修复浏览器验收 ' + Date.now();
  await projectDialog.getByRole('textbox', { name: '项目名称', exact: true }).fill(projectName);
  await projectDialog.getByRole('button', { name: '创建项目', exact: true }).click();
  await projectDialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '新建第一个任务', exact: true }).click();
  const taskDialog = page.getByRole('dialog', { name: '新建任务', exact: true }), taskName = '清楚的分析入口';
  await taskDialog.getByRole('textbox', { name: '任务名称', exact: true }).fill(taskName);
  await taskDialog.getByRole('button', { name: '创建任务', exact: true }).click();
  await taskDialog.waitFor({ state: 'detached' });
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  await input.waitFor();
  await page.locator('.automatic-verification').waitFor();
  const before = (await metrics()).requestCount;
  const symptoms = [];
  if (await page.locator('.chat-page').getByRole('button', { name: /需求梳理/ }).count() === 0) symptoms.push('TR02: analysis task has no requirements entry');
  if (await page.getByRole('navigation', { name: '分析任务步骤', exact: true }).count() === 0) symptoms.push('TR03: analysis task has no preparation/progress navigation');
  const automatic = page.locator('.automatic-verification');
  const automaticSummary = automatic.locator('summary').filter({ hasText: '自动核算与修订' }).first();
  if (await automaticSummary.count() === 0 || !await automaticSummary.evaluate(element => element.parentElement instanceof HTMLDetailsElement && !element.parentElement.open)) symptoms.push('TR03: automatic verification is not collapsed by default');
  assert(symptoms.length === 0, symptoms.join('; '));
  checks.push('Report symptoms: requirements entry, task-stage navigation and automatic panel default collapse.');
  await page.waitForFunction(() => document.querySelector('details.automatic-verification')?.getAttribute('aria-busy') === 'false');
  assert(!(await automaticSummary.innerText()).includes('状态待确认'), 'A fresh task with no automatic records must not display an uncertain-operation status.');
  checks.push('A fresh task with no automatic records does not claim an uncertain operation.');
  if (target === 'automatic-empty-state') return { result: 'PASS', checks, browserErrors: errors.length, externalRequests: outbound.length };

  const nav = page.getByRole('navigation', { name: '分析任务步骤', exact: true });
  for (const step of ['资料准备', '需求梳理', '分析对话', '结果与核算']) assert(await nav.getByRole('button', { name: new RegExp(step) }).isVisible(), 'Task step must be a reachable action: ' + step);
  assert(await nav.locator('[aria-current="step"]').count() === 1, 'Exactly one observable task stage is current.');
  const draft = '这句尚未发送的草稿需要保留';
  const saved = page.waitForResponse(response => response.url().endsWith('/draft') && response.request().method() === 'PATCH' && response.request().postDataJSON().text === draft && response.ok());
  await input.fill(draft); await saved;
  const taskUrl = page.url();
  const requirementEntry = nav.getByRole('button', { name: /需求梳理/ });
  await requirementEntry.focus(); await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: '需求梳理', exact: true }).waitFor();
  await page.getByRole('button', { name: /返回分析任务/ }).click();
  await input.waitFor();
  assert(await input.inputValue() === draft, 'Task requirements round-trip preserves the unsent draft.');
  assert(page.url() === taskUrl, 'Task requirements round-trip preserves selected project/task identity.');
  assert((await metrics()).requestCount === before, 'Opening requirements and returning must not send a model request.');
  checks.push('Keyboard requirements navigation and return preserve task/draft without model work.');

  await automaticSummary.focus(); await page.keyboard.press('Enter');
  assert(await automaticSummary.evaluate(element => element.parentElement.open), 'Keyboard expands automatic verification.');
  const settings = automatic.getByRole('button', { name: /设置|启用/ }).first();
  await settings.click();
  const settingsDialog = page.getByRole('dialog', { name: '自动核算与修订设置', exact: true });
  await settingsDialog.waitFor();
  await settingsDialog.getByRole('button', { name: '关闭设置并保留输入', exact: true }).click();
  await settingsDialog.waitFor({ state: 'hidden' });
  assert(await settings.evaluate(element => element === document.activeElement), 'Closing settings restores focus to its trigger.');
  await automaticSummary.click();
  checks.push('Collapsed automatic panel expands, opens original settings and returns focus.');

  await nav.getByRole('button', { name: /资料准备/ }).click();
  await files().waitFor();
  await files().getByLabel('上传位置', { exact: true }).selectOption('020_clean');
  const upload = files().getByLabel('选择上传文件', { exact: true });
  const accept = await upload.getAttribute('accept');
  for (const extension of ['.pdf', '.docx', '.html', '.mhtml', '.ppt', '.pptx', '.xls', '.xlsx']) assert(accept?.split(',').some(value => value.trim() === extension), 'Upload picker must accept ' + extension);
  const binary = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00, 0xff, 0x80, 0x0a]);
  await Promise.all([
    page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/files/upload') && response.ok()),
    upload.setInputFiles({ name: 'synthetic-binary.pdf', mimeType: 'application/pdf', buffer: binary }),
  ]);
  await page.getByRole('status').filter({ hasText: '上传已保存到分析区' }).waitFor();
  const projectId = new URL(taskUrl).searchParams.get('project');
  assert(projectId, 'Normal task navigation must retain its project identity.');
  const download = async name => {
    const response = await page.request.get(`${baseUrl}/api/projects/${projectId}/files/content?path=${encodeURIComponent('020_clean/' + name)}`, { headers: { 'x-optracall-client': '1' } });
    assert(response.ok(), 'Uploaded file must be downloadable: ' + name);
    return await response.body();
  };
  assert((await download('synthetic-binary.pdf')).equals(binary), 'Binary upload/download must retain exact original bytes.');
  const { writeFile } = await import('node:fs/promises');
  const maximum = Buffer.alloc(50 * 1024 * 1024, 0x9d); Buffer.from('%PDF-1.7\n').copy(maximum);
  const maximumPath = `${artifactDir}/synthetic-50m.pdf`, oversizedPath = `${artifactDir}/synthetic-oversize.pdf`;
  await writeFile(maximumPath, maximum); await writeFile(oversizedPath, Buffer.alloc(maximum.length + 1));
  // Playwright caps inline buffers at 50 MB. Real paths exercise the browser's
  // FileReader without reducing the product's exact 50 MiB boundary.
  await Promise.all([
    page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/files/upload') && response.ok()),
    upload.setInputFiles(maximumPath),
  ]);
  assert((await download('synthetic-50m.pdf')).equals(maximum), 'Exactly 50 MiB must survive FileReader, Host upload and download unchanged.');
  const acceptedUploads = uploads.length;
  await upload.setInputFiles(oversizedPath);
  await files().getByRole('alert').filter({ hasText: '单文件不超过 50 MiB' }).waitFor();
  assert(uploads.length === acceptedUploads, 'Oversize browser input must be rejected before an upload request.');
  assert((await metrics()).requestCount === before, 'Preparing a binary file must not call a model.');
  await files().getByRole('button', { name: '关闭项目文件栏', exact: true }).click();
  checks.push('Requested document picker formats, binary/50 MiB FileReader upload/download byte equality, and 50 MiB + 1 rejection before HTTP.');

  const createSecondTask = page.getByRole('button', { name: `在 ${projectName} 中新建任务`, exact: true });
  await createSecondTask.click();
  await taskDialog.getByRole('textbox', { name: '任务名称', exact: true }).fill('第二个独立任务');
  await taskDialog.getByRole('button', { name: '创建任务', exact: true }).click();
  await taskDialog.waitFor({ state: 'detached' });
  await automaticSummary.waitFor();
  assert(await automaticSummary.evaluate(element => !element.parentElement.open), 'A second task starts with automatic verification collapsed.');
  assert(await input.inputValue() === '', 'A second task does not inherit the first task draft.');
  await page.getByRole('button', { name: taskName, exact: true }).click();
  await page.waitForFunction(value => document.querySelector('#message-input')?.value === value, draft);
  assert(await automaticSummary.evaluate(element => !element.parentElement.open), 'Returning to a task does not leave another task panel expanded.');
  checks.push('Task switching keeps independent drafts and defaults the automatic panel to collapsed.');

  for (const theme of ['light', 'dark']) {
    const themeToggle = page.getByRole('button', { name: theme === 'dark' ? '切换为深色' : '切换为浅色', exact: true });
    if (await themeToggle.count()) await themeToggle.click();
    for (const width of [1440, 768, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} task workspace must not overflow at ${width}px.`);
      assert(await nav.isVisible(), 'Task steps remain visible at ' + width);
      const composer = await input.boundingBox();
      assert(composer && composer.width > 100 && composer.x >= 0 && composer.x + composer.width <= width, 'Composer must remain usable at ' + width);
      await page.screenshot({ path: `${artifactDir}/task-${theme}-${width}.png`, fullPage: true });
    }
  }
  checks.push('1440/768/320px light/dark task steps, composer and overflow checks.');
  assert(errors.length === 0, 'No browser exceptions: ' + errors.join('; '));
  assert(outbound.length === 0, 'No remote browser requests: ' + outbound.join('; '));
  assert((await metrics()).requestCount === before, 'UI navigation/settings/uploads must not invoke models.');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await input.fill('请给出一段合成回复，用于验证结果导航。');
  await page.waitForFunction(() => document.querySelector('.send-button')?.disabled === false);
  await input.press('Enter');
  await page.getByRole('button', { name: '将最新回复保存为最终报告', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('nav[aria-label="分析任务步骤"] [aria-current="step"]')?.textContent?.includes('结果与核算'));
  assert((await metrics()).requestCount === before + 1, 'One explicit synthetic analysis must make exactly one SDK request.');
  await page.screenshot({ path: `${artifactDir}/task-with-result.png`, fullPage: true });
  await page.reload();
  await page.locator('.message.assistant .message-content').first().waitFor();
  assert((await metrics()).requestCount === before + 1, 'Reloading the completed task must restore its history without replay.');
  checks.push('One explicit synthetic SDK reply updates current results navigation and restores across reload without replay.');
  return { result: 'PASS', checks, browserErrors: errors.length, externalRequests: outbound.length };
}
