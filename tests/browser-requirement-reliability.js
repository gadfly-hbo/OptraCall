// Run with an already prepared isolated QA UI on 4183. `page` may be a
// Playwright Page or Cua's documented Playwright facade; no API or model call
// is made by this browser flow. The caller checks persisted API readback and
// synthetic-Provider requests separately. Never use this against user data.
const assert = (value, message) => { if (!value) throw new Error(message); };

async function isolated(page) {
  const origin = await page.evaluate(() => document.location.origin);
  assert(origin === 'http://127.0.0.1:4183', 'Use the isolated QA UI on 4183');
}

// Preconditions: the send dialog is open and no project has been selected.
export async function checkNoImplicitProject(page) {
  await isolated(page);
  const dialog = page.getByRole('dialog', { name: '送入分析', exact: true });
  const create = dialog.getByRole('button', { name: '新建任务并选中', exact: true });
  assert(await create.evaluate(button => button.disabled), 'Creating a task without selecting a project must be disabled');
  const selected = await dialog.getByRole('combobox').first().evaluate(select => select.value);
  assert(selected === '', 'Opening send must not silently select the first project');
  return { unselectedProject: true, creationDisabled: true };
}

// Preconditions: an open send dialog and a fixture project with zero tasks.
// This is a separate case from a later nonempty project in the project list.
export async function checkEmptyProjectSelection(page, projectId) {
  await isolated(page);
  const dialog = page.getByRole('dialog', { name: '送入分析', exact: true });
  const select = dialog.getByRole('combobox').first();
  await select.selectOption(projectId);
  assert(await select.evaluate(input => input.value) === projectId, 'A project with no tasks must remain selected');
  assert(!await dialog.getByRole('button', { name: '新建任务并选中', exact: true }).evaluate(button => button.disabled), 'The selected empty project must allow task creation');
  return { selectedProjectId: projectId };
}

// Preconditions: send is open; no task with `createdTaskName` exists yet.
// The caller also verifies the new task belongs to projectId via normal API
// readback and that the first/unselected project's task list is unchanged.
export async function checkTaskCreationTarget(page, { projectId, createdTaskName }) {
  await isolated(page);
  const dialog = page.getByRole('dialog', { name: '送入分析', exact: true });
  const project = dialog.getByRole('combobox').first();
  await project.selectOption(projectId);
  await dialog.getByRole('button', { name: '新建任务并选中', exact: true }).click();
  const task = dialog.getByRole('combobox').nth(1);
  const created = task.getByRole('option', { name: createdTaskName, exact: true });
  const createdId = await created.evaluate(option => option.value);
  assert(await project.evaluate(input => input.value) === projectId, 'Task creation must keep the selected project, not list[0]');
  assert(await task.evaluate(input => input.value) === createdId, 'The created task must be selected');
  return { selectedProjectId: projectId, createdTaskId: createdId };
}

// Preconditions: Stage 04 of an instance with releases 1.9.0 and 1.10.0;
// a target project and existing task; no Case banner is attached yet.
export async function checkPublishedVersionTransfer(page, { version, projectId, taskId }) {
  await isolated(page);
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const row = page.getByRole('row', { name: new RegExp(`^${escaped}\\s`) });
  await row.getByRole('button', { name: '送入分析 →', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '送入分析', exact: true });
  await dialog.getByRole('combobox').first().selectOption(projectId);
  await dialog.getByRole('combobox').nth(1).selectOption(taskId);
  await dialog.getByRole('button', { name: '前往发送 →', exact: true }).click();
  const banner = await page.locator('.case-context-banner').innerText();
  assert(banner.includes(`RAP ${version}`), `The chat must attach exactly clicked RAP ${version}`);
  return { version, banner };
}

// Preconditions: Stage 01 has exactly one unanswered clarification. Opening
// the editor must not write answered or fabricate a placeholder answer.
export async function checkAnswerEditor(page) {
  await isolated(page);
  await page.getByRole('button', { name: '直接回答', exact: true }).click();
  const answer = page.getByRole('textbox', { name: '澄清回答', exact: true });
  assert(await answer.count() === 1, 'Direct answer must open a real labeled text editor');
  assert(await answer.evaluate(input => input.value) === '', 'A new answer editor must not fabricate a placeholder answer');
  assert(await page.getByRole('button', { name: '保存回答', exact: true }).evaluate(button => button.disabled), 'An empty answer cannot be saved as answered');
  return { answerEditorVisible: true, emptySaveDisabled: true };
}

// Preconditions: an answer editor is open. The caller reopens the instance
// through the normal UI between the initial and revised save and checks API
// readback; it also asserts old snapshot/release bytes remain unchanged.
export async function saveClarificationAnswer(page, answer) {
  await isolated(page);
  await page.getByRole('textbox', { name: '澄清回答', exact: true }).fill(answer);
  await page.getByRole('button', { name: '保存回答', exact: true }).click();
  await page.getByRole('button', { name: '编辑回答', exact: true }).evaluate(button => Boolean(button));
  const shown = await page.locator('.re-clr-answer').innerText();
  assert(shown === `答：${answer.trim()}`, 'The saved clarification must show the real answer');
  assert(await page.getByRole('textbox', { name: '澄清回答', exact: true }).count() === 0, 'Successful save must close the editor');
  return { savedAnswer: answer.trim() };
}

// Preconditions: a saved answer is visible in a single clarification.
export async function cancelClarificationEdit(page, savedAnswer) {
  await isolated(page);
  await page.getByRole('button', { name: '编辑回答', exact: true }).click();
  const answer = page.getByRole('textbox', { name: '澄清回答', exact: true });
  assert(await answer.evaluate(input => input.value) === savedAnswer, 'Editing must prefill the actual existing answer');
  await answer.fill('这份未保存修改必须丢弃');
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  assert(await page.locator('.re-clr-answer').innerText() === `答：${savedAnswer}`, 'Cancel must preserve the original answer');
  return { cancelPreservedAnswer: savedAnswer };
}
