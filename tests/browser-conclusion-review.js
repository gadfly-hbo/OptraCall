import assert from 'node:assert/strict';

export async function openConclusionReview(page) {
  assert.equal(new URL(page.url()).origin, 'http://127.0.0.1:4283', 'Use the isolated conclusion-review browser fixture');
  const results = page.getByRole('region', { name: '结果与审查', exact: true });
  await results.waitFor();
  assert.equal(await results.count(), 1, 'The existing results area uses the approved review entry');
  assert.equal(await page.getByRole('button', { name: '配置自动核算', exact: true }).count(), 0, 'The retired automatic configuration action is removed');
  assert.equal(await page.getByRole('button', { name: '核算关键结论', exact: true }).count(), 0, 'New manual calculations use the conclusion-review entry');
  await results.getByRole('button', { name: '审查结论与建议', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '审查结论与建议', exact: true });
  await panel.waitFor();
  return panel;
}

export async function checkConclusionClaims(panel, { reportPath, sha256 }) {
  await panel.getByRole('heading', { name: '逐条意见', exact: true }).waitFor();
  const version = panel.locator('.cnr-version');
  assert.ok((await version.innerText()).includes(reportPath));
  assert.equal(await version.locator('code').innerText(), sha256);
  for (const label of ['证据支持', '有条件支持', '证据不足', '与证据冲突']) {
    assert.equal(await panel.locator('.cnr-verdict').getByText(label, { exact: true }).count(), 1);
  }
  assert.equal(await panel.getByRole('textbox').count(), 0, 'Conclusion review has no manual calculation question');
  assert.equal(await panel.getByRole('button', { name: '查看本版报告', exact: true }).count(), 1);
}

export async function checkLegacyReviewReadOnly(panel) {
  await panel.getByRole('button', { name: '历史记录', exact: true }).click();
  const fold = panel.locator('.automatic-fold-heading');
  await fold.click();
  await panel.getByText('旧自动核算与修订 · 已停用', { exact: true }).waitFor();
  for (const name of ['配置自动核算', '开始核算', '停止本次核算', '依据核算意见生成新稿', '发起一次知情复查', '另存核算报告', '显式新建一次核算', '停止本次自动处理', '重试资源清理', '设置并启用', '保存任务设置']) {
    assert.equal(await panel.getByRole('button', { name, exact: true }).count(), 0, `Retired history must not expose ${name}`);
  }
  assert.equal(await panel.locator('.verification-form').count(), 0);
}

export async function checkConclusionPreparedOnly(panel, marker) {
  await panel.getByText(/固定依据与提供记录 ·/).click();
  const actual = panel.getByRole('region', { name: '实际提供记录', exact: true });
  await actual.getByText('实际提供范围未记录／未知', { exact: true }).waitFor();
  assert.equal(await actual.locator('pre').count(), 0, 'Prepared metadata is not a native delivery receipt');
  assert.equal(await panel.getByText(marker, { exact: false }).count(), 0, 'Unproved prepared text must not be shown as actually supplied');
}

export async function checkConclusionSuppliedMaterial(panel, { marker, source, sha256 }) {
  await panel.getByText(/固定依据与提供记录 ·/).click();
  const actual = panel.getByRole('region', { name: '实际提供记录', exact: true });
  await actual.getByText('原生请求已核对', { exact: true }).waitFor();
  const material = actual.locator('details').filter({ hasText: source });
  await material.locator('summary').click();
  assert.ok((await material.innerText()).includes(sha256));
  assert.ok((await material.locator('pre').innerText()).includes(marker));
  await material.getByText(/实际提供正文范围/).waitFor();
  assert.equal(await actual.getByText(/提供记录不证明模型已阅读、理解或采用/).count(), 1);
}
