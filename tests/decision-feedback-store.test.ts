import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectStore, type ProjectConfiguration } from '../src/host/project-store.ts';
import { createRequirementStore } from '../extensions/business-plugins/requirements-elaboration/storage/store.ts';
import { DecisionFeedbackStore } from '../src/host/decision-feedback-store.ts';

const configuration: ProjectConfiguration = { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'https://example.invalid' };
test('feedback task creation is idempotent and never replaces an existing task draft or history', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'feedback-store-'));
  const store = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') });
  await store.init(); t.after(async () => { await store.close(); await fs.rm(root, { recursive: true, force: true }); });
  const project = await store.create({ name: '合成反馈项目', configuration });
  const original = await store.createTask(project.id, { name: '原分析任务' });
  await store.saveDraft(project.id, original.id, '保留原草稿');
  const input = { taskId: randomUUID(), name: '新复盘', draft: '本次普通问题', feedbackOrigin: { handoffId: randomUUID(), operationId: randomUUID(), requestHash: 'a'.repeat(64) } };
  const task = await store.createTaskWithFeedback(project.id, input);
  assert.equal(task.id, input.taskId); assert.equal(task.draft, '本次普通问题'); assert.deepEqual(task.feedbackOrigin, input.feedbackOrigin);
  assert.equal(task.sessionFile, undefined); assert.equal(task.lastRun, undefined); assert.equal(task.configuration.id, configuration.id);
  await store.saveDraft(project.id, task.id, '用户后来修改的草稿');
  const again = await store.createTaskWithFeedback(project.id, input);
  assert.equal(again.draft, '用户后来修改的草稿'); assert.equal((await store.get(project.id)).tasks.length, 2);
  assert.equal((await store.getTask(project.id, original.id)).draft, '保留原草稿');
  await assert.rejects(store.createTaskWithFeedback(project.id, { ...input, feedbackOrigin: { ...input.feedbackOrigin, requestHash: 'b'.repeat(64) } }), /feedback_origin_conflict/);
});

test('feedback operation records survive reopen, reject another writer and retain corrupt evidence', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'feedback-ledger-'));
  const store = new DecisionFeedbackStore({ root }); store.init();
  t.after(async () => { store.close(); await fs.rm(root, { recursive: true, force: true }); });
  const second = new DecisionFeedbackStore({ root }); assert.throws(() => second.init(), /feedback_store_locked/);
  const operationId = randomUUID(), handoffId = randomUUID(), sourceProjectId = randomUUID(), now = new Date().toISOString();
  store.saveOperation({ schemaVersion: 1, operationId, handoffId, sourceProjectId, kind: 'handoff', requestHash: 'e'.repeat(64), createdAt: now, updatedAt: now, phase: 'prepared', planned: { taskId: randomUUID() }, request: {}, steps: { task: { state: 'pending' } } });
  store.close(); const reopened = new DecisionFeedbackStore({ root }); reopened.init();
  try {
    assert.equal(reopened.getOperation(operationId)?.phase, 'prepared');
    const file = path.join(root, 'operations', operationId + '.json'), before = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, before.replace('prepared', 'completed'));
    assert.throws(() => reopened.getOperation(operationId), /feedback_record_corrupt/);
    assert.equal(await fs.readFile(file, 'utf8'), before.replace('prepared', 'completed'));
  } finally { reopened.close(); }
});

test('feedback requirement creation publishes an identifiable unconfirmed draft and retry preserves edits', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'feedback-requirement-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createRequirementStore(path.join(root, 'requirements'));
  const input = { instanceId: 'req-' + randomUUID().replace(/-/g, '').slice(0, 12), title: '下一轮需求', scene: 'topic' as const, background: '选定回复片段：效果仍未知', origin: { operationId: randomUUID(), handoffId: randomUUID(), requestHash: 'c'.repeat(64) } };
  const instance = store.createFromFeedback(input);
  assert.equal(instance.context.background, input.background); assert.equal(instance.snapshot, undefined); assert.deepEqual(instance.facts, []);
  assert.equal(store.releases(input.instanceId).length, 0); assert.equal(store.list().length, 1);
  store.save({ ...instance, context: { ...instance.context, background: '用户修改后的背景' } });
  assert.equal(store.createFromFeedback(input).context.background, '用户修改后的背景');
  assert.deepEqual(store.readFeedbackOrigin(input.instanceId), input.origin);
  assert.throws(() => store.createFromFeedback({ ...input, origin: { ...input.origin, requestHash: 'd'.repeat(64) } }), /REQ_FEEDBACK_ORIGIN_CONFLICT/);
  const reopened = createRequirementStore(store.root); assert.equal(reopened.list().length, 1); assert.deepEqual(reopened.readFeedbackOrigin(input.instanceId), input.origin);
});

test('failed requirement publication leaves only isolated staging and explicit resume publishes the original identity', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'feedback-requirement-publish-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createRequirementStore(path.join(root, 'requirements')), existing = store.create({ title: '保留旧需求', scene: 'topic' });
  const input = { instanceId: 'req-' + randomUUID().replace(/-/g, '').slice(0, 12), title: '中断的新需求', scene: 'topic' as const, background: '固定片段', origin: { operationId: randomUUID(), handoffId: randomUUID(), requestHash: 'f'.repeat(64) } };
  const rename = fsSync.renameSync, target = path.join(store.root, input.instanceId);
  const hook = t.mock.method(fsSync, 'renameSync', (from: fsSync.PathLike, to: fsSync.PathLike) => { if (String(to) === target) { const error = new Error('synthetic disk interruption') as NodeJS.ErrnoException; error.code = 'EIO'; throw error; } return rename(from, to); }); syncBuiltinESMExports();
  try { assert.throws(() => store.createFromFeedback(input), /synthetic disk interruption/); }
  finally { hook.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(fsSync.existsSync(target), false); assert.deepEqual(store.list().map(value => value.id), [existing.instance.id]);
  const stagingBefore = await fs.readdir(store.root + '.feedback-staging'); assert.ok(stagingBefore.length >= 2);
  assert.throws(() => store.createFromFeedback(input), /REQ_FEEDBACK_CREATION_NEEDS_REVIEW/);
  const resumed = store.createFromFeedback({ ...input, resume: true }); assert.equal(resumed.instance.id, input.instanceId); assert.equal(resumed.context.background, '固定片段');
  assert.equal(store.list().length, 2); assert.deepEqual(await fs.readdir(store.root + '.feedback-staging'), []);
});

test('a killed feedback writer can reopen only after verified dead-pid lock recovery without replaying its intent', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'feedback-dead-writer-')), operationId = randomUUID();
  const moduleUrl = pathToFileURL(path.resolve('src/host/decision-feedback-store.ts')).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {DecisionFeedbackStore} from ${JSON.stringify(moduleUrl)};const store=new DecisionFeedbackStore({root:process.argv[1]});store.init();const now=new Date().toISOString();store.saveOperation({schemaVersion:1,operationId:${JSON.stringify(operationId)},handoffId:${JSON.stringify(randomUUID())},sourceProjectId:${JSON.stringify(randomUUID())},kind:'handoff',requestHash:'a'.repeat(64),createdAt:now,updatedAt:now,phase:'needs_review',planned:{},request:{},steps:{task:{state:'unknown'}}});process.stdout.write('ready');setInterval(()=>{},1000);`, root], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); } await fs.rm(root, { recursive: true, force: true }); });
  await once(child.stdout, 'data');
  const live = new DecisionFeedbackStore({ root }); assert.throws(() => live.init(), /feedback_store_locked/);
  child.kill('SIGKILL'); await once(child, 'exit');
  const reopened = new DecisionFeedbackStore({ root }); reopened.init();
  try { assert.equal(reopened.getOperation(operationId)?.phase, 'needs_review'); assert.deepEqual(await fs.readdir(path.join(root, 'handoffs')), []); }
  finally { reopened.close(); }
});

test('two simultaneous dead-writer recoveries cannot unlink the winning live writer lock', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'feedback-recovery-race-')), lock = path.join(root, '.write.lock'), moduleUrl = pathToFileURL(path.resolve('src/host/decision-feedback-store.ts')).href;
  const dead = spawn(process.execPath, ['-e', 'process.exit(0)']); await once(dead, 'exit');
  await fs.writeFile(lock, JSON.stringify({ token: randomUUID(), pid: dead.pid }));
  const children: ReturnType<typeof spawn>[] = [];
  t.after(async () => { for (const child of children) if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); } await fs.rm(root, { recursive: true, force: true }); });
  const script = `import fs from 'node:fs';import {DecisionFeedbackStore} from ${JSON.stringify(moduleUrl)};const unlink=fs.unlinkSync;fs.unlinkSync=(file)=>{if(String(file)===process.argv[1]+'/.write.lock'){process.stdout.write('waiting\\n');fs.readFileSync(0);}return unlink(file)};try{const store=new DecisionFeedbackStore({root:process.argv[1]});store.init();process.stdout.write('acquired\\n');setInterval(()=>{},1000)}catch(error){process.stdout.write('rejected:'+error.code+'\\n')}`;
  const launch = () => { const child = spawn(process.execPath, ['--input-type=module', '-e', script, root], { stdio: ['pipe', 'pipe', 'pipe'] }); children.push(child); return child; };
  const a = launch(); assert.match(String((await once(a.stdout!, 'data'))[0]), /waiting/);
  const b = launch(), bFirst = String((await once(b.stdout!, 'data'))[0]);
  a.stdin!.end('release'); assert.match(String((await once(a.stdout!, 'data'))[0]), /acquired/);
  let bResult = bFirst;
  if (bFirst.includes('waiting')) { b.stdin!.end('release'); bResult = String((await once(b.stdout!, 'data'))[0]); }
  assert.match(bResult, /rejected:feedback_store_locked/);
  assert.equal(JSON.parse(await fs.readFile(lock, 'utf8')).pid, a.pid);
});
