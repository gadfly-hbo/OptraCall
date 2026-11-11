import assert from 'node:assert/strict';

export async function openFramework(page, title) {
  const entry = new URL(page.url());
  assert.equal(entry.hostname, '127.0.0.1', 'Use the isolated browser fixture only');
  await page.getByRole('button', { name: '插件市场', exact: true }).click();
  await page.getByRole('button', { name: '业务插件', exact: true }).click();
  await page.getByRole('button', { name: '打开需求梳理', exact: true }).click();
  await page.locator('.re-instance-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).getByRole('button', { name: /打开/ }).click();
  await page.getByRole('button', { name: /分析与报告框架/ }).click();
  return page.getByRole('region', { name: '分析与报告框架', exact: true });
}

export async function checkFrameworkInputs(framework, rapVersion) {
  const input = framework.getByRole('combobox', { name: '框架输入' });
  assert.equal(await input.count(), 1, 'Show the exact published RAP selection alongside the current draft');
  assert.equal(await input.inputValue(), '', 'Default to the current draft without choosing a release silently');
  assert.equal(await input.getByRole('option', { name: `RAP ${rapVersion}`, exact: true }).count(), 1);
  await input.selectOption(rapVersion);
  await framework.getByRole('button', { name: '生成框架', exact: true }).waitFor();
  const search = framework.locator('details').filter({ hasText: '公开检索主题' });
  assert.equal(await search.getAttribute('open'), null, 'The public topic is optional and initially collapsed');
  await search.locator('summary').click();
  assert.equal(await search.getByRole('textbox', { name: '公开检索主题', exact: true }).inputValue(), '', 'Do not copy the draft title into public context');
}

export async function generateFramework(framework, { decision, scope, gap, rapVersion, publicStatus }) {
  await framework.getByRole('button', { name: /^(重新生成|生成框架)$/ }).click();
  const paper = framework.getByRole('article', { name: '本轮分析框架', exact: true });
  await paper.getByText(decision, { exact: true }).waitFor();
  await paper.getByText(scope, { exact: true }).waitFor();
  await paper.getByText(gap, { exact: true }).waitFor();
  const versionText = await paper.locator('.re-framework-version').innerText();
  const version = versionText.match(/[a-f0-9-]{36}/)?.[0];
  assert.ok(version, 'Show the complete generated framework version');
  assert.ok(versionText.includes(rapVersion ? `基于 RAP ${rapVersion}` : '基于当前需求工作稿'));
  await framework.getByText(`公开行业案例 · ${publicStatus}`, { exact: true }).waitFor();
  return { version, paper };
}

export async function confirmDisplayedFramework(page, paper, version) {
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/confirm-framework') && response.request().method() === 'POST');
  const confirm = paper.getByRole('button', { name: '确认分析框架', exact: true });
  await confirm.focus();
  await confirm.press('Enter');
  const response = await responsePromise;
  assert.ok(response.ok(), await response.text());
  assert.equal(response.request().postDataJSON().version, version, 'Confirmation must send the version visible in the framework');
  await paper.getByRole('status').filter({ hasText: /^已确认$/ }).waitFor();
  assert.equal(await paper.getByRole('button', { name: '确认分析框架', exact: true }).count(), 0, 'An accepted version needs one confirmation');
}

export async function attachRequirement(page, { projectId, taskId, version, published = false }) {
  await page.getByRole('button', { name: /检查与交付/ }).click();
  if (published) {
    await page.getByRole('row').filter({ hasText: version }).getByRole('button', { name: '送入分析 →', exact: true }).click();
  } else {
    await page.getByRole('button', { name: '送入本轮框架', exact: true }).click();
  }
  const dialog = page.getByRole('dialog', { name: '送入分析', exact: true });
  assert.ok((await dialog.innerText()).includes(version), 'The existing send dialog must show the exact selection');
  const project = dialog.getByRole('combobox', { name: '项目', exact: true });
  assert.equal(await project.evaluate(select => document.activeElement === select), true, 'Keyboard focus starts inside the modal');
  await project.selectOption(projectId);
  await dialog.getByRole('combobox', { name: '任务', exact: true }).selectOption(taskId);
  await dialog.getByRole('button', { name: '前往发送 →', exact: true }).click();
  await page.locator('summary').filter({ hasText: /^本次分析背景/ }).first().click();
  const banner = page.locator('.case-context-banner').filter({ hasText: version });
  await banner.waitFor();
  assert.ok((await banner.innerText()).includes(published ? `RAP ${version}` : `框架版本 ${version}`));
}

export async function checkFormalConfirmationRequired(page) {
  await page.getByRole('button', { name: /检查与交付/ }).click();
  const action = page.getByRole('button', { name: '送入本轮框架', exact: true });
  await action.waitFor();
  assert.ok(await action.isDisabled(), 'Framework confirmation leaves the existing formal demand gate in place');
  assert.ok(await action.getAttribute('aria-describedby'), 'Explain why the confirmed framework cannot be sent yet');
}

export async function checkUnsavedCoreGoal(page, goal) {
  await page.getByRole('button', { name: /诉求与澄清/ }).click();
  const input = page.getByRole('textbox', { name: '核心目标', exact: true });
  await input.fill(goal);
  await page.getByRole('button', { name: /分析与报告框架/ }).click();
  await page.getByText('四要素还有未保存的修改，生成时使用已保存的内容。', { exact: true }).waitFor();
  await page.getByRole('article', { name: '本轮分析框架', exact: true }).waitFor();
  await page.getByRole('button', { name: /诉求与澄清/ }).click();
  assert.equal(await input.inputValue(), goal, 'Refreshing framework status preserves unsaved workbench input');
}
