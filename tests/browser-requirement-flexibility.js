// Run through Cua against an isolated QA Host and synthetic Provider on 4183.
// The caller separately verifies API readback, native output, and file bytes.
const assert = (value, message) => { if (!value) throw new Error(message); };
const isolated = async page => assert(await page.evaluate(() => document.location.origin) === 'http://127.0.0.1:4183', 'Use only the isolated QA UI');

// Preconditions: Stage03 of an unconfirmed instance, before generation.
export async function checkDraftEntry(page) {
  await isolated(page);
  assert(await page.getByText('未确认也可先生成框架草稿；正式发布与送入仍需有效确认。', { exact: true }).count() === 1, 'Framework exploration must explain that confirmation is not a prerequisite');
  assert(await page.getByRole('button', { name: '生成框架', exact: true }).isEnabled(), 'An unconfirmed instance can generate a draft');
  return { draftEntry: true };
}

// Preconditions: a completed framework generation proposal is visible.
export async function checkDraftProposal(page, expectedConfirmation, { question, risk }) {
  await isolated(page);
  const card = page.getByRole('complementary', { name: 'AI 提案卡', exact: true });
  assert(await card.getByText('未确认框架草稿', { exact: true }).count() === 1, 'Generated framework is always a proposal');
  assert((await card.locator('.re-proposal-source').innerText()).includes(expectedConfirmation), 'The proposal must show the captured input confirmation state');
  assert(await card.getByRole('button', { name: '采纳建议', exact: true }).isEnabled(), 'A draft requires explicit adoption');
  assert(await card.getByText(question, { exact: true }).count() === 1, 'Show the actual unresolved question before adoption');
  assert(await card.getByText(risk, { exact: true }).count() === 1, 'Show the actual risk before adoption');
  return { unconfirmedDraft: true, source: await card.locator('.re-proposal-source').innerText() };
}

// Preconditions: an explicit no-change response with all three arrays empty.
export async function acknowledgeNoChange(page, reason) {
  await isolated(page);
  const card = page.getByRole('complementary', { name: 'AI 提案卡', exact: true });
  assert(await card.getByText(reason, { exact: true }).count() === 1, 'Show why no further questions or hypotheses are needed');
  assert(await card.getByRole('button', { name: '采纳建议', exact: true }).count() === 0, 'Acknowledging no change must not write a fake adoption');
  await card.getByRole('button', { name: '知道了', exact: true }).click();
  assert(await page.getByRole('complementary', { name: 'AI 提案卡', exact: true }).count() === 0, 'Acknowledgement dismisses the proposal');
  return { noChangeAcknowledged: true };
}

// Preconditions: the adopted descriptive framework is shown in Stage03.
export async function checkDescriptivePath(page) {
  await isolated(page);
  const row = page.getByRole('row').filter({ hasText: '各门店当日销售额是多少？' });
  assert((await row.innerText()).includes('描述性分析（无需假设）'), 'A descriptive path must not fabricate a hypothesis');
  return { descriptivePath: true };
}
