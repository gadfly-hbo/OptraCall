import assert from 'node:assert/strict';

export async function confirmedHandoffControls(panel, { supported, conditional, recommendation, unsupportedRecommendation }) {
  const handoff = panel.getByRole('region', { name: '带入决策看板', exact: true });
  await handoff.waitFor();
  const submit = handoff.getByRole('button', { name: '确认并带入看板', exact: true });
  assert.equal(await submit.isDisabled(), true, 'A conclusion must be selected explicitly');
  const conclusion = handoff.getByRole('checkbox', { name: new RegExp(supported) });
  const condition = handoff.getByRole('checkbox', { name: new RegExp(conditional) });
  const action = handoff.getByRole('checkbox', { name: new RegExp(recommendation) });
  assert.equal(await action.isDisabled(), true, 'An action must be linked to a selected conclusion');
  assert.equal(await handoff.getByRole('checkbox', { name: new RegExp(unsupportedRecommendation) }).isDisabled(), true, 'The action itself must have supporting review evidence');
  return { handoff, submit, conclusion, condition, action };
}

export async function checkHandoffUnknown(handoff, operationId) {
  await handoff.getByText('确认结果未知，操作编号', { exact: false }).waitFor();
  assert.ok((await handoff.innerText()).includes(operationId));
  assert.equal(await handoff.getByRole('button', { name: '确认并带入看板', exact: true }).count(), 0, 'Unknown receipts expose only a read-only operation query');
  assert.equal(await handoff.getByRole('button', { name: '查询原提交状态', exact: true }).count(), 1);
}

export async function checkBoardConfirmedReport(page, { text, sha256 }) {
  const reports = page.getByRole('region', { name: '项目报告', exact: true });
  const confirmed = reports.locator('.board-confirmed');
  await confirmed.waitFor();
  if ((await confirmed.getAttribute('open')) === null) await confirmed.locator('summary').click();
  assert.ok((await confirmed.innerText()).includes(text));
  assert.ok((await confirmed.innerText()).includes(sha256));
  assert.ok((await confirmed.innerText()).includes('报告确认交接'));
  assert.equal(await confirmed.getByText(/置信度|标签参考值/).count(), 0);
  return confirmed;
}
