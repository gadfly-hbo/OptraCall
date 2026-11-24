import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID, createHash} from 'node:crypto';
import {runtimeEnvironment} from '../scripts/runtime-process.ts';
import {startToolProvider} from './fixtures/tool-provider.ts';
import {chromium} from '/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, '..');
const evidenceDir = path.join(workspace, '.local/issue-128/browser');
await mkdir(evidenceDir, {recursive: true});
const root = path.join(workspace, '.local/issue-128/browser-root-' + Date.now());
const dataRoot = path.join(root, 'host'), projectsRoot = path.join(root, 'projects');
await mkdir(dataRoot, {recursive: true});
await mkdir(projectsRoot, {recursive: true});

const provider = await startToolProvider();
const uiPort = 4191;
const child = spawn(process.execPath, [path.join(workspace, 'scripts/host-entry.mjs'), '--port=0', `--ui-port=${uiPort}`, `--data-root=${dataRoot}`, `--projects-root=${projectsRoot}`, `--ui-root=${path.join(workspace, 'dist')}`], {cwd: workspace, env: runtimeEnvironment(), stdio: ['ignore', 'pipe', 'pipe']});
let stdout = '', stderr = '';
child.stdout.on('data', chunk => { stdout += chunk; });
child.stderr.on('data', chunk => { stderr += chunk; });
const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('host startup timeout')); }, 20000);
  child.stdout.on('data', () => { for (const line of stdout.split('\n')) { try { const data = JSON.parse(line); if (data.kind === 'host-ready') { clearTimeout(timer); resolve(data.port); } } catch {} } });
  child.once('exit', code => { clearTimeout(timer); reject(new Error(`host exited ${code}: ${stderr}`)); });
});
const base = `http://127.0.0.1:${port}`;
const headers = {'content-type': 'application/json', 'x-optracall-client': '1', origin: `http://127.0.0.1:${uiPort}`};
const api = async (route, method = 'GET', body) => {
  const response = await fetch(base + route, {method, headers, ...(body !== undefined ? {body: JSON.stringify(body)} : {})});
  const result = await response.json();
  if (response.status >= 400) throw new Error(`${method} ${route} → ${response.status} ${JSON.stringify(result)}`);
  return result;
};
const results = [];
const check = (name, ok, detail = '') => { results.push({name, ok, detail}); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); if (!ok) process.exitCode = 1; };
const scope = {kind: 'department', id: 'state-east', name: '状态验证部门'};
const scopeKey = 'department::state-east';
let browser;
try {
  await api('/api/configuration', 'PUT', {name: '状态合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-state', apiKey: 'synthetic-state-only'});
  const initiativeId = randomUUID();
  await api('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '状态验证事项', scopes: [scope]});
  provider.setResponder(() => ({text: '保持运行', hold: true}));

  browser = await chromium.launch({channel: 'chrome', headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 900}});
  const external = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    external.push(url.href);
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(base, {waitUntil: 'networkidle'});
  await page.getByRole('button', {name: '战略选择'}).click();
  await page.waitForSelector('select[aria-label="战略事项"]');
  await page.selectOption('select[aria-label="战略事项"]', initiativeId);
  await page.waitForSelector('#si-main-text');
  await page.fill('#si-main-text', '请持续核对这条合成讨论。');
  await page.getByRole('button', {name: '发送讨论'}).click();
  await provider.waitForRequests(1);
  await page.waitForTimeout(700);
  const body = await page.locator('body').innerText();
  check('I128-04 已受理运行中不显示结果待核', !body.includes('原请求结果待核'), body.match(/.{0,30}结果待核.{0,50}/)?.[0] ?? 'no unknown banner');
  check('I128-04 已受理运行中呈现进度', body.includes('Agent 正在讨论与核对') || body.includes('正在运行') || body.includes('已受理'));
  const session = await api(`/api/strategy/initiatives/${initiativeId}/session?scopeKey=${encodeURIComponent(scopeKey)}`);
  check('I128-04 pending 防重复派发保持', session.session.pendingInput && session.session.lastRun.status === 'accepted' && provider.requests.length === 1, JSON.stringify({requests: provider.requests.length, status: session.session.lastRun.status}));
  await page.screenshot({path: path.join(evidenceDir, 'main-running.png'), fullPage: false});
  check('零外部浏览器请求', external.length === 0, JSON.stringify(external));
  await api(`/api/strategy/initiatives/${initiativeId}/stop?scopeKey=${encodeURIComponent(scopeKey)}`, 'POST', {});

  const fields = {horizon: '2027–2029', diagnosis: '首版诊断：客流稳定，优先验证复购。', propositions: [{id: 'P1', question: '复购能否驱动增长？', whyItMatters: '决定资源投向。'}, {id: 'P2', question: '触达能否规模化？', whyItMatters: '决定是否推广。'}, {id: 'P3', question: '如何分配有限预算？', whyItMatters: '决定取舍。'}], assumptions: '', evidenceGaps: '', followUp: ''};
  const blocksA = [{id: 'B1', label: '定位与增长', text: '首版方案：先以三店分层回访验证复购。'}, {id: 'B2', label: '目标与资源', text: '2027 三店试点，暂缓大规模开店。'}];
  const blocksV2 = [{...blocksA[0], text: '修订版方案：先验证成熟店，再考虑新店。'}, blocksA[1]];
  const blocksB = [{id: 'B1', label: '定位与增长', text: '替代方案：以陈列、排班和转化改善验证增长。'}, {id: 'B2', label: '目标与资源', text: '2027 基线核对，优先一线培训。'}];
  const textSha = value => createHash('sha256').update(value).digest('hex');
  const waitUntil = async (read, label, timeout = 30000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const value = await read();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out: ${label}`);
  };
  const appliedInitiative = async (title, targetScope, kickoffFields = fields) => {
    const id = randomUUID();
    await api('/api/strategy/initiatives', 'POST', {operationId: id, title, scopes: [targetScope]});
    const root = `/api/strategy/initiatives/${id}`;
    const content = `合成依据：${title}，首购会员 90 天二购率约 9%。`;
    const file = (await api(`${root}/files`, 'POST', {operationId: randomUUID(), directory: '010_draw', name: '经营依据.md', contentBase64: Buffer.from(content).toString('base64')})).file;
    const report = (await api(`${root}/reports`, 'POST', {operationId: randomUUID(), fields: kickoffFields, sources: [{kind: 'file', ref: '010_draw/经营依据.md', fileId: file.fileId, sha256: file.sha256}]})).version;
    await api(`${root}/reports/1/lock`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256});
    await api(`${root}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256, scope: targetScope});
    return {id, root, file, report, content};
  };
  const saveResponder = blocks => ctx => ctx.recentToolResults.length
    ? {text: '候选已保存，请核对并锁定。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: blocks, candidateGoals: ['90天二购率达到12%', '试点触达率达到80%']}}]};
  const apiCandidate = async (root, targetScope, title, blocks) => {
    provider.setResponder(saveResponder(blocks));
    const created = (await api(`${root}/candidates`, 'POST', {operationId: randomUUID(), scope: targetScope, title, instruction: '形成合成备选方案。'})).candidate;
    return waitUntil(async () => {
      const detail = await api(`${root}/candidates/${created.candidateId}/versions/1`);
      return detail.candidate.lastRun?.status === 'completed' ? detail.candidate : null;
    }, `candidate ${title}`);
  };
  const lockApi = async (root, candidate) => (await api(`${root}/candidates/${candidate.candidateId}/versions/1/lock`, 'POST', {operationId: randomUUID(), sha256: candidate.contentSha256})).candidate;
  const verificationResponder = (sources, verdict = 'pass') => ctx => ctx.recentToolResults.length
    ? {text: '本道检验结论已提交。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-verification', verdict, evidence: verdict === 'pass' ? '关键因果链与假设已核对，依据见锁定版资源条款。' : '关键因果链存在缺环，当前不能放行。', verificationSources: sources}}]};
  const jointScope = {kind: 'department', id: 'joint-east', name: '青禾便利东区'};
  const jointKey = 'department::joint-east';
  const joint = await appliedInitiative('联合验收事项', jointScope);
  const jointBase = joint.root;
  await api(`${jointBase}/reports`, 'POST', {operationId: randomUUID(), fields: {...fields, diagnosis: '第二版诊断：不能替代本次引用的首版。'}, sources: [], parent: 1});
  await page.reload({waitUntil: 'networkidle'});
  await page.getByRole('button', {name: '战略选择'}).click();
  await page.selectOption('select[aria-label="战略事项"]', joint.id);
  await page.getByRole('button', {name: '方案成型 · 战略候选'}).click();
  provider.setResponder(saveResponder(blocksA));
  await page.getByRole('button', {name: '＋ 新建候选'}).click();
  await page.fill('#si-candidate-title', '主链候选');
  await page.fill('#si-candidate-instruction', '形成用于联合验收的方案。');
  await page.getByRole('button', {name: '启动独立会话'}).click();
  const candidateA = await waitUntil(async () => (await api(`${jointBase}/candidates?scopeKey=${encodeURIComponent(jointKey)}`)).candidates.find(item => item.title === '主链候选' && item.lastRun?.status === 'completed'), 'main candidate');
  await page.locator('.si-candidate-card', {hasText: '主链候选'}).click();
  await page.getByRole('button', {name: '审核并锁定'}).click();
  await page.getByRole('button', {name: '确认锁定'}).click();
  await page.waitForSelector('section[aria-label="战略检验"]');
  const lockedA = (await api(`${jointBase}/candidates/${candidateA.candidateId}/versions/1`)).candidate;
  const candidateV2 = (await api(`${jointBase}/candidates/${candidateA.candidateId}/versions/1/revise`, 'POST', {operationId: randomUUID(), baseSha256: lockedA.contentSha256, request: '合成另存修订版，保留父版。', patches: [{blockId: 'B1', expectedOldSha256: textSha(blocksA[0].text), newText: blocksV2[0].text}]})).candidate;
  check('I128-02 限定修订另存父版', candidateV2.no === 2 && candidateV2.parent?.no === 1);
  await page.reload({waitUntil: 'networkidle'});
  await page.getByRole('button', {name: '战略选择'}).click();
  await page.selectOption('select[aria-label="战略事项"]', joint.id);
  await page.getByRole('button', {name: '战略检验', exact: true}).click();

  const sources = [
    {kind: 'kickoff', ref: '1', sha256: joint.report.contentSha256},
    {kind: 'candidate', ref: `${candidateA.candidateId}:1`, sha256: lockedA.contentSha256},
    {kind: 'file', ref: '010_draw/经营依据.md', fileId: joint.file.fileId, sha256: joint.file.sha256},
    {kind: 'public', ref: 'https://example.com/no-snapshot', sha256: 'd'.repeat(64)},
  ];
  provider.setResponder(verificationResponder(sources));
  await page.getByRole('button', {name: '启动检验'}).click();
  await page.waitForSelector('text=两份结论已绑定同一锁定版', {timeout: 60000});
  check('I128 联合串行双检验通过', true);
  const kickoffButton = page.getByRole('button', {name: /核对依据 · 开题版本/}).first();
  await kickoffButton.focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.si-version-dialog');
  let dialogText = await page.locator('.si-version-dialog').innerText();
  check('I128-05 旧开题按准确版本打开', dialogText.includes('开题报告 · v1') && dialogText.includes('首版诊断') && !dialogText.includes('第二版诊断'));
  await page.keyboard.press('Escape');
  check('I128-05 Escape 返回原检验位置', await kickoffButton.evaluate(element => element === document.activeElement));
  await page.getByRole('button', {name: /核对依据 · 候选版本/}).first().click();
  dialogText = await page.locator('.si-version-dialog').innerText();
  check('I128-05 父版候选不被最新版替代', dialogText.includes('主链候选 · v1') && dialogText.includes('首版方案') && !dialogText.includes('修订版方案'));
  await page.getByRole('button', {name: '关闭', exact: true}).last().click();
  await page.getByRole('button', {name: /核对依据 · 文件/}).first().click();
  dialogText = await page.locator('.si-version-dialog').innerText();
  check('I128-05 文件按准确指纹只读预览', dialogText.includes(joint.file.sha256) && dialogText.includes(joint.content));
  await page.getByRole('button', {name: '关闭', exact: true}).last().click();
  await page.getByRole('button', {name: /核对依据 · 公开来源/}).first().click();
  dialogText = await page.locator('.si-version-dialog').innerText();
  check('I128-05 公开来源无快照时如实不可核对', dialogText.includes('准确快照') && dialogText.includes('不访问当前网页'));
  await page.getByRole('button', {name: '关闭', exact: true}).last().click();

  const indexPath = path.join(dataRoot, 'strategy-initiatives', joint.id, 'files.json');
  const originalIndex = await readFile(indexPath, 'utf8');
  const index = JSON.parse(originalIndex);
  const stored = index.files.find(item => item.fileId === joint.file.fileId);
  const filePath = path.join(dataRoot, 'strategy-initiatives', joint.id, 'files', stored.directory, stored.storedName);
  const originalBytes = await readFile(filePath);
  const changed = Buffer.from('已变化的合成文件，不能冒充原检验依据。');
  await writeFile(filePath, changed);
  stored.sha256 = createHash('sha256').update(changed).digest('hex');
  stored.size = changed.length;
  await writeFile(indexPath, JSON.stringify(index));
  await page.getByRole('button', {name: /核对依据 · 文件/}).first().click();
  dialogText = await page.locator('.si-version-dialog').innerText();
  check('I128-05 指纹不符保留身份原因且不展示正文', dialogText.includes('指纹与检验引用不符') && dialogText.includes(stored.sha256) && !dialogText.includes('已变化的合成文件'));
  await page.getByRole('button', {name: '关闭', exact: true}).last().click();
  await writeFile(filePath, originalBytes);
  await writeFile(indexPath, originalIndex);
  index.files = index.files.filter(item => item.fileId !== joint.file.fileId);
  await writeFile(indexPath, JSON.stringify(index));
  await page.getByRole('button', {name: /核对依据 · 文件/}).first().click();
  dialogText = await page.locator('.si-version-dialog').innerText();
  check('I128-05 文件缺失保留引用身份', dialogText.includes(joint.file.fileId) && dialogText.includes(joint.file.sha256));
  await page.getByRole('button', {name: '关闭', exact: true}).last().click();
  await writeFile(indexPath, originalIndex);
  await page.screenshot({path: path.join(evidenceDir, 'sources-1440.png')});

  await page.getByRole('button', {name: '前往战略发布'}).click();
  await page.getByRole('button', {name: '核对并正式发布'}).click();
  const publishButton = page.getByRole('button', {name: '确认发布'});
  check('SS10 未确认不可发布', await publishButton.isDisabled());
  await page.getByRole('checkbox', {name: '我已核对准确版方案及两份带依据的检验结论。'}).check();
  await publishButton.click();
  await page.waitForSelector('button:has-text("带入目标管理")');
  const publicationA = (await api(`${jointBase}/publications?scopeKey=${encodeURIComponent(jointKey)}`)).publications.find(item => item.state === 'active');
  await page.getByRole('button', {name: '带入目标管理'}).click();
  check('I128-03 新部门默认当前战略范围', await page.locator('#si-handoff-scope').inputValue() === jointKey && (await page.locator('#si-handoff-scope').innerText()).includes('当前战略范围'));
  check('I128-03 历史误归属有补救说明', (await page.locator('dialog').innerText()).includes('历史误存个人范围') && (await page.locator('dialog').innerText()).includes('提出目标修订'));
  await page.selectOption('#si-handoff-scope', 'personal::self');
  await page.getByRole('button', {name: '保存目标候选'}).click();
  await page.waitForSelector('text=批目标候选已导入');
  const personalGoals = (await api('/api/strategy/goals')).goals;
  check('I128 合成历史个人范围保留来源', personalGoals.length === 2 && personalGoals.every(goal => goal.versions[0].scope.kind === 'personal' && goal.versions[0].strategyContext.summary.includes(publicationA.publicationId)));
  await page.getByRole('button', {name: '带入目标管理'}).click();
  await page.getByRole('button', {name: '保存目标候选'}).click();
  await page.waitForTimeout(700);
  const allGoals = (await api('/api/strategy/goals')).goals;
  check('I128-03 承接后归属与准确发布来源', allGoals.length === 4 && allGoals.slice(2).every(goal => goal.versions[0].scope.id === jointScope.id && goal.versions[0].strategyContext.summary.includes(publicationA.publicationId)));
  await page.getByRole('button', {name: '目标管理', exact: true}).click();
  await page.getByRole('heading', {name: '目标管理', exact: true}).waitFor();
  await page.locator('.sg-goal-item').last().click();
  await page.waitForTimeout(300);
  check('I128-03 目标管理重开可见', (await page.locator('body').innerText()).includes('青禾便利东区'));
  await page.locator('details.sg-origin summary').click();
  check('I128-03 目标详情回看准确发布来源', (await page.locator('details.sg-origin').innerText()).includes(publicationA.publicationId));
  await page.getByRole('button', {name: '战略选择', exact: true}).click();
  await page.selectOption('select[aria-label="战略事项"]', joint.id);
  await page.getByRole('button', {name: '方案成型 · 战略候选'}).click();
  provider.setResponder(saveResponder(blocksB));
  await page.getByRole('button', {name: '＋ 新建候选'}).click();
  await page.fill('#si-candidate-title', '替代发布候选');
  await page.fill('#si-candidate-instruction', '形成用于同范围替代的方案。');
  await page.getByRole('button', {name: '启动独立会话'}).click();
  const candidateB = await waitUntil(async () => (await api(`${jointBase}/candidates?scopeKey=${encodeURIComponent(jointKey)}`)).candidates.find(item => item.title === '替代发布候选' && item.lastRun?.status === 'completed'), 'replacement candidate');
  await page.locator('.si-candidate-card', {hasText: '替代发布候选'}).click();
  await page.getByRole('button', {name: '审核并锁定'}).click();
  await page.getByRole('button', {name: '确认锁定'}).click();
  await page.waitForSelector('section[aria-label="战略检验"]');
  const lockedB = (await api(`${jointBase}/candidates/${candidateB.candidateId}/versions/1`)).candidate;
  provider.setResponder(verificationResponder([{kind: 'candidate', ref: `${candidateB.candidateId}:1`, sha256: lockedB.contentSha256}]));
  await page.getByRole('button', {name: '启动检验'}).click();
  await page.waitForSelector('text=两份结论已绑定同一锁定版', {timeout: 60000});
  await page.getByRole('button', {name: '前往战略发布'}).click();
  await page.getByRole('button', {name: '核对并正式发布'}).click();
  await page.getByRole('checkbox', {name: '我已核对准确版方案及两份带依据的检验结论。'}).check();
  await page.getByRole('button', {name: '确认发布'}).click();
  await waitUntil(async () => (await api(`${jointBase}/publications?scopeKey=${encodeURIComponent(jointKey)}`)).publications.some(item => item.candidateId === candidateB.candidateId && item.state === 'active'), 'replacement publication');
  const publications = (await api(`${jointBase}/publications?scopeKey=${encodeURIComponent(jointKey)}`)).publications;
  check('SS11 同范围唯一当前发布并保留替代链', publications.filter(item => item.state === 'active').length === 1 && publications.find(item => item.publicationId === publicationA.publicationId)?.state === 'replaced');
  await page.getByRole('button', {name: '撤销发布'}).click();
  await page.getByRole('button', {name: '确认撤销发布'}).click();
  await page.waitForSelector('text=此版已撤销', {timeout: 30000});
  const withdrawn = (await api(`${jointBase}/publications?scopeKey=${encodeURIComponent(jointKey)}`)).publications.find(item => item.state === 'withdrawn');
  const republish = await fetch(base + `${jointBase}/publications`, {method: 'POST', headers, body: JSON.stringify({operationId: randomUUID(), candidateId: candidateB.candidateId, no: 1, sha256: lockedB.contentSha256, batchId: withdrawn.batchId, confirmed: true, expectedActive: null})});
  check('SS11 撤销后同版禁止重发', republish.status === 409 && (await republish.json()).code === 'strategy_publication_withdrawn_locked');
  await page.getByRole('button', {name: '版本管理', exact: true}).click();
  await page.locator('.si-ledger-row button', {hasText: '主链候选 · v1'}).first().click();
  await page.waitForSelector('.si-version-dialog');
  dialogText = await page.locator('.si-version-dialog').innerText();
  check('SS13 版本回看保留父版和承接来源', dialogText.includes('承接') && dialogText.includes(publicationA.publicationId.slice(0, 8)));
  await page.getByRole('button', {name: '关闭', exact: true}).last().click();
  await page.setViewportSize({width: 390, height: 844});
  await page.getByRole('button', {name: '战略检验', exact: true}).click();
  await page.selectOption('select[aria-label="所见版本"]', `${candidateA.candidateId}:1`);
  await page.getByRole('button', {name: /核对依据 · 开题版本/}).first().click();
  await page.waitForSelector('.si-version-dialog');
  const box = await page.locator('.si-version-dialog').boundingBox();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('SS16 390px 来源弹窗和页面无横向溢出', box && box.x >= 0 && box.x + box.width <= 390 && overflow <= 0, JSON.stringify({box, overflow}));
  await page.screenshot({path: path.join(evidenceDir, 'sources-390.png')});
  await page.getByRole('button', {name: '关闭', exact: true}).last().click();

  const failed = await appliedInitiative('首道不通过事项', {kind: 'department', id: 'gate-east', name: '门禁部门'});
  const failedCandidate = await apiCandidate(failed.root, {kind: 'department', id: 'gate-east', name: '门禁部门'}, '门禁候选', blocksA);
  const failedLocked = await lockApi(failed.root, failedCandidate);
  const gateScope = 'department::gate-east';
  provider.setResponder(verificationResponder([{kind: 'kickoff', ref: '1', sha256: failed.report.contentSha256}], 'fail'));
  await api(`${failed.root}/candidates/${failedCandidate.candidateId}/versions/1/verify`, 'POST', {operationId: randomUUID()});
  const failedBatch = await waitUntil(async () => (await api(`${failed.root}/candidates/${failedCandidate.candidateId}/versions/1/verifications`)).batches.find(item => item.state === 'returned'), 'failed gate');
  const deniedPublish = await fetch(base + `${failed.root}/publications`, {method: 'POST', headers, body: JSON.stringify({operationId: randomUUID(), candidateId: failedCandidate.candidateId, no: 1, sha256: failedLocked.contentSha256, batchId: failedBatch.batchId, confirmed: true, expectedActive: null})});
  check('SS09 第一道不通过停止后续且发布零资格', failedBatch.gates[1].status === 'waiting' && !failedBatch.gates[1].requestId && deniedPublish.status === 409, JSON.stringify({second: failedBatch.gates[1].status, publish: deniedPublish.status}));
  check('零外部浏览器请求', external.length === 0, JSON.stringify(external));
} catch (error) {
  check('联合浏览器执行异常', false, String(error?.stack ?? error));
} finally {
  if (browser) await browser.close().catch(() => {});
  child.kill('SIGTERM');
  await once(child, 'exit').catch(() => {});
  await provider.close();
  await writeFile(path.join(evidenceDir, 'results.json'), JSON.stringify({results, stderr: stderr.slice(0, 2000)}, null, 2));
}
