import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectPlanPreparationPrompt, parseProjectPlanPreparationResponse, projectPlanPreparationInputHash, type ProjectPlanPreparationInput } from '../src/host/project-plan-preparation.ts';
const seed = (): ProjectPlanPreparationInput => ({ projectId: '00000000-0000-4000-8000-000000000001', projectName: '已有业务问题', existingTasks: [{ id: '00000000-0000-4000-8000-000000000002', name: '已有综合任务' }], capabilities: { skills: [{ id: 'actual-skill', title: '现有专业能力', version: '1' }], methods: [], connectors: [], materials: [{ kind: 'project-file', id: '020_clean/list.csv', title: '资料清单', version: 'v1' }], caseContexts: [] }, plan: { request: '按本项目已有说明核对问题范围', premises: ['基本期间待补'], materials: [{ kind: 'project-file', id: '020_clean/list.csv', version: 'v1' }], coverage: [], tasks: [{ key: 'existing', name: '已有综合任务', taskId: '00000000-0000-4000-8000-000000000002', selected: true, scope: '', capabilities: [{ kind: 'skill', id: 'actual-skill', version: '1' }] }], taskMode: 'single', summaryTaskKey: 'existing', dependencies: [], caseContext: null } });

test('lightweight preparation prompt uses metadata and original scope while forbidding data analysis or task execution', () => {
  const input = seed(); Object.assign(input.existingTasks[0], { draft: 'DO_NOT_INCLUDE_NATIVE_OR_DRAFT_BODY', sessionFile: '/private/native.jsonl' });
  const prompt = buildProjectPlanPreparationPrompt(input);
  assert.match(prompt, /诉求、资料清单、已有说明和基本前提/); assert.match(prompt, /不得.*全面读取.*试算.*归因/);
  assert.match(prompt, /不创建.*Task.*不启动.*分析/); assert.match(prompt, /MECE/); assert.match(prompt, /本轮重点/);
  assert.match(prompt, /已有综合任务/); assert.match(prompt, /actual-skill/); assert.doesNotMatch(prompt, /DO_NOT_INCLUDE_NATIVE_OR_DRAFT_BODY|\/private\/native\.jsonl/);
});
const review = { sameLevel: '同层按职责检查', coverage: '保留待核范围', boundaries: '交叉处明确责任', depth: '与本轮诉求一致' };
test('preparation parses the existing JSON envelope into an editable proposal and retains exact chosen references', () => {
  const input = seed(), plan = structuredClone(input.plan); plan.coverage.push({ key: 'scope', label: '现有问题范围', disposition: 'focus', reason: '从已有说明初判', taskKeys: ['existing'] });
  const result = parseProjectPlanPreparationResponse('建议草稿如下：\n```json\n' + JSON.stringify({ plan, mece: review, limitations: ['基本期间仍待用户补充'] }) + '\n```', input);
  assert.deepEqual(result, { plan, mece: review, limitations: ['基本期间仍待用户补充'] });
  result.plan.tasks[0].name = '只改返回草稿'; assert.equal(input.plan.tasks[0].name, '已有综合任务');
});
test('preparation refuses invented references, permission substitutions, dropped chosen methods and Case retargeting', () => {
  const input = seed();
  input.capabilities.connectors.push({ id: 'weather', title: '已授权天气', enabled: true, requiresPermission: true, permissionRef: 'task:existing:weatherTools' });
  const parse = (change: (plan: typeof input.plan) => void) => { const plan = structuredClone(input.plan); change(plan); return () => parseProjectPlanPreparationResponse(JSON.stringify({ plan, mece: review, limitations: [] }), input); };
  assert.throws(parse(plan => { plan.tasks[0].capabilities.push({ kind: 'skill', id: 'invented' }); }), /project_plan_preparation_reference/);
  assert.throws(parse(plan => { plan.tasks[0].capabilities.push({ kind: 'connector', id: 'weather', permissionRef: 'ungranted' }); }), /project_plan_preparation_reference/);
  assert.throws(parse(plan => { plan.tasks[0].capabilities = []; }), /project_plan_preparation_selection/);
  assert.throws(parse(plan => { plan.materials = []; }), /project_plan_preparation_selection/);
  assert.throws(parse(plan => { plan.caseContext = { caseId: input.projectId, primaryGoal: { goalId: input.projectId, version: 1 } }; }), /project_plan_preparation_context/);
  assert.throws(parse(plan => { plan.tasks[0].taskId = input.projectId; }), /project_plan_preparation_task/);
  Object.assign(input.existingTasks[0], { archivedAt: '2026-11-16T00:00:00.000Z' });
  assert.throws(parse(() => {}), /project_plan_preparation_task/);
});
test('preparation preserves an accurate Case and its fixed versions and hashes only the original preparation input', () => {
  const input = seed(); input.plan.caseContext = { caseId: input.projectId, primaryGoal: { goalId: input.projectId, version: 2 }, caseRevision: 4, projectWorkRevision: 2 };
  const envelope = { plan: input.plan, mece: review, limitations: [] };
  assert.deepEqual(parseProjectPlanPreparationResponse(JSON.stringify(envelope), input).plan.caseContext, input.plan.caseContext);
  const changed = structuredClone(envelope); changed.plan.caseContext!.caseRevision = 5;
  assert.throws(() => parseProjectPlanPreparationResponse(JSON.stringify(changed), input), /project_plan_preparation_context/);
  const request = { operationId: input.projectId, expectedRevision: 0, plan: input.plan };
  assert.equal(projectPlanPreparationInputHash(request), projectPlanPreparationInputHash({ plan: input.plan, expectedRevision: 0, operationId: input.projectId }));
  assert.notEqual(projectPlanPreparationInputHash(request), projectPlanPreparationInputHash({ ...request, plan: changed.plan }));
});

test('preparation preserves an explicitly chosen direct goal version and purpose and refuses to remove, invent or reassign it', () => {
  const input = seed(); input.plan.goalContext = { goal: { goalId: input.projectId, version: 3 }, purpose: 'assigned-work' };
  const envelope = { plan: structuredClone(input.plan), mece: review, limitations: [] };
  const prompt = buildProjectPlanPreparationPrompt(input); assert.match(prompt, /保留 goalContext/); assert.match(prompt, /assigned-work/); assert.match(prompt, /"version":3/);
  assert.deepEqual(parseProjectPlanPreparationResponse(JSON.stringify(envelope), input).plan.goalContext, input.plan.goalContext);
  const changed = structuredClone(envelope); changed.plan.goalContext!.purpose = 'query';
  assert.throws(() => parseProjectPlanPreparationResponse(JSON.stringify(changed), input), /project_plan_preparation_context/);
  const removed = structuredClone(envelope); delete removed.plan.goalContext;
  assert.throws(() => parseProjectPlanPreparationResponse(JSON.stringify(removed), input), /project_plan_preparation_context/);
  const noGoal = seed();
  assert.throws(() => parseProjectPlanPreparationResponse(JSON.stringify(envelope), noGoal), /project_plan_preparation_context/);
});
