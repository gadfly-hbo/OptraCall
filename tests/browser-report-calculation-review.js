import assert from 'node:assert/strict';

export async function checkCalculationReviewRecord(page, { path, initialText, requestId }) {
  assert.equal(new URL(page.url()).origin, 'http://127.0.0.1:4283', 'Use the isolated calculation-review browser fixture');
  const result = page.getByRole('region', { name: /结果与(?:核算|审查)/ });
  const summary = result.locator('summary').filter({ hasText: /^报告计算复核 · 意见已交回$/ });
  await summary.waitFor();
  assert.equal(await summary.count(), 1, 'Show the actual foreground review outcome in the existing task results');
  const details = summary.locator('..');
  assert.equal(await details.getAttribute('open'), null, 'The review record is optional and initially collapsed');
  await summary.click();
  assert.ok((await details.innerText()).includes(path), 'The record identifies the reviewed initial draft');
  assert.ok((await details.innerText()).includes(requestId), 'The record binds the parent request');
  const read = page.waitForResponse(response => response.url().includes('/report-calculation-reviews/') && response.request().method() === 'GET');
  await details.getByRole('button', { name: '查看被复核初稿', exact: true }).click();
  const response = await read;
  assert.ok(response.ok(), await response.text());
  assert.equal(new URL(response.url()).searchParams.get('expectedReceiptSha256')?.length, 64, 'Historical draft read uses the exact receipt hash');
  await details.getByText(initialText, { exact: true }).waitFor();
  return { details, response: await response.json() };
}
