import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { approvedTaskSkills, makeTaskAssignment } from '../src/host/task-assignment.ts';
import { loadFixedBuiltInSkill, packageIdentity, projectSkillCatalog } from '../src/agent/skill-catalog.ts';
import { resolveProtectedSkillSnapshot } from '../src/agent/protected-skills.ts';
import { createMemberPackFeature } from '../src/host/member-pack-host.ts';
import { EnterpriseScopeStore } from '../src/host/enterprise-scope-store.ts';
import { ProjectStore } from '../src/host/project-store.ts';
import { StudioStore } from '../extensions/business-plugins/studio/store.ts';

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const systemTextOf = (requests: { body: { messages?: { role: string; content?: unknown }[] } }[]) =>
  requests
    .flatMap(r => (r.body.messages ?? []).filter(m => m.role === 'system' || m.role === 'developer'))
    .map(m => providerMessageText(m.content))
    .join('\n');

async function json(response: Response, status = 200): Promise<any> {
  const text = await response.clone().text();
  assert.equal(response.status, status, `Expected ${status}, got ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function waitTaskSettled(host: Awaited<ReturnType<typeof startTestHost>>, projectId: string, taskId: string, cookie?: string) {
  const started = Date.now();
  while (Date.now() - started < 45_000) {
    const res = await fetch(`${host.baseUrl}/api/projects/${projectId}/tasks/${taskId}`, {
      headers: { ...host.headers, ...(cookie ? { cookie } : {}) },
    });
    if (res.status === 409) {
      await new Promise(r => setTimeout(r, 40));
      continue;
    }
    const state = await json(res, 200);
    if (state.task.lastRun && state.task.lastRun.status !== 'running' && state.snapshot.status === 'idle') {
      return state;
    }
    await new Promise(r => setTimeout(r, 40));
  }
  throw new Error('Timed out waiting for task settlement');
}

function parseCsvRows(csvText: string): Record<string, string>[] {
  const lines = csvText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const headerIdx = lines.findIndex(line => line.includes(','));
  if (headerIdx < 0) return [];
  const header = lines[headerIdx]!.split(',').map(cell => cell.trim());
  const rows: Record<string, string>[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const parts = lines[i]!.split(',').map(cell => cell.trim());
    if (parts.length !== header.length) continue;
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) row[header[j]!] = parts[j]!;
    rows.push(row);
  }
  return rows;
}

function computeStore30dRepurchaseFromRows(membersText: string, ordersText: string, refundsText: string) {
  const members = parseCsvRows(membersText).filter(r => r.cohort_month === '2026-06');
  const orders = parseCsvRows(ordersText);
  const fullRefundOrders = new Set(
    parseCsvRows(refundsText).filter(r => r.full_refund === 'true').map(r => r.order_id),
  );
  const validOrdersByMember = new Map<string, { order_id: string; store: string; order_date: string }[]>();
  for (const order of orders) {
    if (fullRefundOrders.has(order.order_id)) continue;
    if (order.order_date < '2026-06-01' || order.order_date > '2026-07-31') continue;
    const list = validOrdersByMember.get(order.member_id) ?? [];
    list.push({ order_id: order.order_id, store: order.store, order_date: order.order_date });
    validOrdersByMember.set(order.member_id, list);
  }
  const byStore: Record<string, { denominator: number; numerator: number }> = {};
  let totalDen = 0;
  let totalNum = 0;
  for (const m of members) {
    const store = m.store;
    byStore[store] ??= { denominator: 0, numerator: 0 };
    byStore[store]!.denominator += 1;
    totalDen += 1;
    const firstMs = Date.parse(m.order_date + 'T00:00:00Z');
    const memberOrders = (validOrdersByMember.get(m.member_id) ?? []).sort((a, b) => a.order_date.localeCompare(b.order_date));
    const hasRepeat = memberOrders.some(o => {
      const diffDays = (Date.parse(o.order_date + 'T00:00:00Z') - firstMs) / 86_400_000;
      return diffDays > 0 && diffDays <= 30;
    });
    if (hasRepeat) {
      byStore[store]!.numerator += 1;
      totalNum += 1;
    }
  }
  return {
    memberCount: members.length,
    orderCount: orders.length,
    refundCount: parseCsvRows(refundsText).length,
    byStore,
    total: { denominator: totalDen, numerator: totalNum },
  };
}

async function seedRestrictedMemberPackScenario(host: Awaited<ReturnType<typeof startTestHost>>, providerBaseUrl: string) {
  await json(await host.request('/api/configuration', 'PUT', {
    name: 'Issue121 Round2 Synthetic',
    provider: 'openai-compatible',
    baseUrl: providerBaseUrl,
    model: 'synthetic-r2',
    apiKey: 'synthetic-only',
  }), 200);

  // Register named maintainer operator
  const opRes = await host.request('/api/studio/operators/session', 'POST', {
    action: 'register',
    operatorId: 'yalan-ops',
    displayName: '雅澜会员运营负责人',
    passcode: 'yalan-2026',
  });
  await json(opRes, 200);
  const ownerCookie = opRes.headers.get('set-cookie')!.split(';')[0]!;
  const ownerReq = (route: string, method = 'GET', body?: unknown) =>
    fetch(host.baseUrl + route, {
      method,
      headers: { ...host.headers, cookie: ownerCookie },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  const ent = await json(await ownerReq('/api/studio/enterprises', 'POST', { requestId: randomUUID(), name: '雅澜服饰合成测试' }), 201);
  const enterpriseId = ent.id as string;

  const ownerProjRes = await ownerReq('/api/projects', 'POST', { name: '雅澜会员建设权责项目' });
  const { project: ownerProject } = await json(ownerProjRes, 201);
  await json(await ownerReq('/api/studio/enterprise-associations', 'POST', {
    requestId: randomUUID(), kind: 'project', entityId: ownerProject.id, enterpriseId,
  }), 200);

  const consumerProjRes = await ownerReq('/api/projects', 'POST', { name: 'T05 甲乙两店复购分析' });
  const { project: consumerProject } = await json(consumerProjRes, 201);
  await json(await ownerReq('/api/studio/enterprise-associations', 'POST', {
    requestId: randomUUID(), kind: 'project', entityId: consumerProject.id, enterpriseId,
  }), 200);

  // Re-bind owner cookie to ownerProject before creating system
  const bindOwner = await ownerReq(`/api/projects/${ownerProject.id}`);
  const activeOwnerCookie = bindOwner.headers.get('set-cookie')?.split(';')[0] ?? ownerCookie;
  const boundOwnerReq = (route: string, method = 'GET', body?: unknown) =>
    fetch(host.baseUrl + route, {
      method,
      headers: { ...host.headers, cookie: activeOwnerCookie },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  const { system } = await json(await boundOwnerReq('/api/studio/systems', 'POST', {
    requestId: randomUUID(),
    enterpriseId,
    name: '雅澜会员运营体系',
    projectId: ownerProject.id,
    goal: '建设雅澜服饰会员复购资产包',
    topicTitle: '会员复购',
  }), 201);

  const { pack } = await json(await boundOwnerReq('/api/studio/enterprise-packs', 'POST', {
    requestId: randomUUID(),
    enterpriseId,
    systemId: system.id,
    projectId: ownerProject.id,
    domain: 'member-operations',
    name: '雅澜服饰 · 会员运营资产包',
  }), 200);

  // Create a consumer browser session cookie bound to consumerProject
  const consumerBindRes = await fetch(`${host.baseUrl}/api/projects/${consumerProject.id}`, {
    headers: host.headers,
  });
  await json(consumerBindRes, 200);
  const consumerCookie = consumerBindRes.headers.get('set-cookie')!.split(';')[0]!;
  const consumerReq = (route: string, method = 'GET', body?: unknown) =>
    fetch(host.baseUrl + route, {
      method,
      headers: { ...host.headers, cookie: consumerCookie },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  return { enterpriseId, ownerProject, consumerProject, system, pack, boundOwnerReq, consumerReq, consumerCookie };
}

test('Item 01 · Restricted member-pack task with default data-analysis Skill actually reads pinned SKILL.md body (Linux read_task_skill & macOS read/symlink), and preserves cancel/collision/ordinary contrasts', { timeout: 90_000 }, async t => {
  const provider = await startToolProvider();
  t.after(() => provider.close());
  const host = await startTestHost();
  t.after(() => host.close());

  const { consumerProject, consumerReq, consumerCookie } = await seedRestrictedMemberPackScenario(host, provider.baseUrl);
  const builtInSkillPath = path.join(process.cwd(), 'extensions', 'analysis-assets', 'data-analysis', 'SKILL.md');
  const builtInMethodPath = path.join(process.cwd(), 'extensions', 'analysis-assets', 'data-analysis', 'references', 'method.md');
  const builtInSkillBody = fs.readFileSync(builtInSkillPath, 'utf8');
  const builtInMethodBody = fs.readFileSync(builtInMethodPath, 'utf8');
  const expectedSha = approvedTaskSkills.analysis!.sha256;
  assert.equal(packageIdentity(builtInSkillPath), expectedSha);
  const builtInHeading = builtInSkillBody.split('\n').find(line => line.startsWith('# '))?.trim() ?? 'name: data-analysis';
  const methodSnippet = builtInMethodBody.split('\n').find(line => line.trim().length > 10 && !line.startsWith('---'))?.trim() ?? '';

  // Add a colliding same-name skill inside consumer project's .pi/skills and .agents/skills
  const piCollisionDir = path.join(consumerProject.rootPath, '020_clean', '.pi', 'skills', 'data-analysis');
  const agentsCollisionDir = path.join(consumerProject.rootPath, '.agents', 'skills', 'data-analysis');
  fs.mkdirSync(piCollisionDir, { recursive: true });
  fs.mkdirSync(agentsCollisionDir, { recursive: true });
  fs.writeFileSync(path.join(piCollisionDir, 'SKILL.md'), '---\nname: data-analysis\ndescription: Colliding project .pi skill\n---\nDO NOT USE\n');
  fs.writeFileSync(path.join(agentsCollisionDir, 'SKILL.md'), '---\nname: data-analysis\ndescription: Colliding .agents skill\n---\nDO NOT USE\n');

  // Also add an unrelated project skill to verify generic catalog order stays intact
  const customSkillDir = path.join(consumerProject.rootPath, '020_clean', '.pi', 'skills', 'deep-research');
  fs.mkdirSync(customSkillDir, { recursive: true });
  fs.writeFileSync(path.join(customSkillDir, 'SKILL.md'), '---\nname: deep-research\ndescription: Project override for catalog order check\n---\nProject copy\n');

  // 1. Restricted member-pack task WITH default Skill enabled
  const { task: restrictedOn } = await json(await consumerReq(`/api/projects/${consumerProject.id}/tasks`, 'POST', {
    name: '受限默认 Skill 开启',
    assignment: makeTaskAssignment('analysis', true),
  }), 201);
  assert.equal(restrictedOn.assignment.skill.id, 'data-analysis');
  assert.equal(restrictedOn.assignment.skill.sha256, expectedSha);

  // Live open check works identically on BOTH macOS (ordinary executionMode) and Linux (unmanaged)
  const openedOn = await json(await consumerReq(`/api/projects/${consumerProject.id}/tasks/${restrictedOn.id}/open`, 'POST', {}), 200);
  assert.equal(openedOn.snapshot.capabilities.skills, true, 'Live opened restricted task with default skill enabled must report capabilities.skills === true');

  const reqStartIdx = provider.requests.length;
  let skillTurn = 0;
  let observedSkillToolResult = '';
  let observedTraversalToolResult = '';
  provider.setResponder(ctx => {
    skillTurn += 1;
    if (skillTurn === 1) {
      const sys = ctx.messages.filter(m => m.role === 'system' || m.role === 'developer').map(m => providerMessageText(m.content)).join('\n');
      if (ctx.availableTools.includes('read_task_skill')) {
        // Linux restrictedHostToolsOnly path: model calls read_task_skill for SKILL.md, bundled reference, and invalid traversal
        return {
          calls: [
            { name: 'read_task_skill', arguments: {} },
            { name: 'read_task_skill', arguments: { file: 'references/method.md' } },
            { name: 'read_task_skill', arguments: { file: '../package.json' } },
          ],
        };
      }
      // macOS protectedTools path: model reads exact <location> advertised by Pi SDK <available_skills>
      const locMatch = /<location>([^<]+SKILL\.md)<\/location>/.exec(sys);
      assert.ok(locMatch?.[1], 'Protected macOS system prompt must expose <location>...SKILL.md</location>');
      assert.ok(ctx.availableTools.includes('read'), 'Protected macOS session must expose read tool');
      return {
        calls: [
          { name: 'read', arguments: { path: locMatch[1] } },
          { name: 'read', arguments: { path: path.join(path.dirname(locMatch[1]), 'references', 'method.md') } },
        ],
      };
    }
    const toolTexts = ctx.recentToolResults.map(m => providerMessageText(m.content));
    observedSkillToolResult = toolTexts.slice(0, 2).join('\n---\n');
    observedTraversalToolResult = toolTexts[2] ?? '';
    return { text: '已实际读取固定 data-analysis Skill 正文并完成回复。' };
  });

  const sendOn = await consumerReq(`/api/projects/${consumerProject.id}/tasks/${restrictedOn.id}/messages`, 'POST', {
    text: '截至 7 月 31 日，甲乙两店 6 月会员的 30 天复购表现有什么差异？',
    requestId: randomUUID(),
  });
  await json(sendOn, 202);
  const stateOn = await waitTaskSettled(host, consumerProject.id, restrictedOn.id, consumerCookie);
  assert.equal(stateOn.task.lastRun.status, 'completed');
  assert.ok(skillTurn >= 2, 'Model must execute tool call to read pinned Skill and receive body in next Provider request');

  // Verify the ACTUAL built-in SKILL.md body & bundled reference entered the subsequent Provider request (and NOT colliding copies)
  assert.ok(observedSkillToolResult.includes(builtInHeading), `Actual built-in SKILL.md heading (${builtInHeading}) must enter Provider tool result`);
  if (methodSnippet) {
    assert.ok(observedSkillToolResult.includes(methodSnippet), 'Actual built-in references/method.md content must enter Provider tool result');
  }
  assert.equal(observedSkillToolResult.includes('DO NOT USE'), false, 'Colliding project/user skill content must never be read');
  if (observedTraversalToolResult) {
    assert.match(observedTraversalToolResult, /task_skill_path_invalid|error|invalid/i, 'Path traversal on read_task_skill must be rejected');
  }

  // Verify system prompt sent to Provider includes pinned data-analysis@2.0.0-candidate.1 and NOT colliding paths
  const restrictedSystem = systemTextOf(provider.requests.slice(reqStartIdx));
  assert.ok(restrictedSystem.includes('data-analysis'), 'System prompt must advertise data-analysis skill');
  assert.ok(restrictedSystem.includes('2.0.0-candidate.1'), 'System prompt must reference pinned version 2.0.0-candidate.1');
  assert.equal(restrictedSystem.includes(path.join(piCollisionDir, 'SKILL.md')), false, 'Colliding .pi skill must never be delivered');
  assert.equal(restrictedSystem.includes(path.join(agentsCollisionDir, 'SKILL.md')), false, 'Colliding .agents skill must never be delivered');

  // Verify /skills on the live restricted Pi session exposes the exact built-in skill (and never colliding copies)
  const skillsCmdOn = await json(await consumerReq(`/api/projects/${consumerProject.id}/tasks/${restrictedOn.id}/commands`, 'POST', {
    text: '/skills',
    requestId: randomUUID(),
  }), 200);
  const loadedRestrictedSkills = skillsCmdOn.result.skills as { name: string; filePath: string }[];
  assert.equal(loadedRestrictedSkills.length, 1);
  assert.equal(loadedRestrictedSkills[0]!.name, 'data-analysis');
  assert.equal(packageIdentity(loadedRestrictedSkills[0]!.filePath), expectedSha);
  assert.equal(path.resolve(loadedRestrictedSkills[0]!.filePath) === path.join(piCollisionDir, 'SKILL.md'), false);
  assert.equal(path.resolve(loadedRestrictedSkills[0]!.filePath) === path.join(agentsCollisionDir, 'SKILL.md'), false);

  // Verify restricted workspace on disk has a dedicated skillRoot (used by macOS sandbox-exec protectedTools)
  const restrictedSkillsDir = path.join(host.dataRoot, 'member-pack-workspaces', consumerProject.id, restrictedOn.id, 'skills');
  assert.ok(fs.existsSync(restrictedSkillsDir), 'Restricted task workspace must provision dedicated skillRoot directory');
  const fixedSkill = loadFixedBuiltInSkill(process.cwd(), 'data-analysis', path.join(consumerProject.rootPath, '020_clean'), path.join(host.dataRoot, 'pi'));
  assert.ok(fixedSkill);
  const builtInSkillEntry = {
    name: fixedSkill.id,
    description: 'built-in',
    filePath: fixedSkill.filePath,
    baseDir: path.dirname(fixedSkill.filePath),
    sourceInfo: { path: fixedSkill.filePath, source: 'explicit' as const, scope: 'project' as const, origin: 'top-level' as const },
    disableModelInvocation: false,
  };
  const collidingUserSkill = {
    name: 'data-analysis',
    description: 'colliding user copy',
    filePath: path.join(piCollisionDir, 'SKILL.md'),
    baseDir: piCollisionDir,
    sourceInfo: { path: path.join(piCollisionDir, 'SKILL.md'), source: 'auto' as const, scope: 'project' as const, origin: 'top-level' as const },
    disableModelInvocation: false,
  };
  // Exact macOS protectedTools + memberPackExecutionScope snapshot path:
  assert.throws(() => resolveProtectedSkillSnapshot({
    restrictedMemberPack: true,
    skillRoot: undefined,
    assignmentSkillId: 'data-analysis',
    baseSkills: [collidingUserSkill],
    selectTaskSkills: () => [builtInSkillEntry],
  }), /task_skill_unavailable/);
  const snapped = resolveProtectedSkillSnapshot({
    restrictedMemberPack: true,
    skillRoot: restrictedSkillsDir,
    assignmentSkillId: 'data-analysis',
    baseSkills: [collidingUserSkill],
    selectTaskSkills: skills => {
      assert.equal(skills.length, 0, 'Restricted member-pack must not pass arbitrary user skills into selectedTaskSkills');
      return [builtInSkillEntry];
    },
  });
  assert.equal(snapped.skills.length, 1);
  assert.equal(snapped.skills[0]!.name, 'data-analysis');
  assert.equal(packageIdentity(snapped.skills[0]!.filePath), expectedSha);
  assert.ok(snapped.skills[0]!.filePath.startsWith(restrictedSkillsDir + path.sep));
  const cancelledSnap = resolveProtectedSkillSnapshot({
    restrictedMemberPack: true,
    skillRoot: restrictedSkillsDir,
    assignmentSkillId: undefined,
    baseSkills: [collidingUserSkill],
    selectTaskSkills: () => [builtInSkillEntry],
  });
  assert.equal(cancelledSnap.skills.length, 0);

  // 2. Restricted member-pack task WITH default Skill explicitly cancelled
  provider.setResponder(() => ({ text: '已按无默认 Skill 状态完成最小回复。' }));
  const { task: restrictedOff } = await json(await consumerReq(`/api/projects/${consumerProject.id}/tasks`, 'POST', {
    name: '受限默认 Skill 取消',
    assignment: makeTaskAssignment('analysis', false),
  }), 201);
  assert.equal(restrictedOff.assignment.skill, null);
  const openedOff = await json(await consumerReq(`/api/projects/${consumerProject.id}/tasks/${restrictedOff.id}/open`, 'POST', {}), 200);
  assert.equal(openedOff.snapshot.capabilities.skills, false, 'Live opened restricted task with cancelled skill must report capabilities.skills === false');

  const offStartIdx = provider.requests.length;
  await json(await consumerReq(`/api/projects/${consumerProject.id}/tasks/${restrictedOff.id}/messages`, 'POST', {
    text: '仅核对取消默认 Skill 时的最小回复。',
    requestId: randomUUID(),
  }), 202);
  const stateOff = await waitTaskSettled(host, consumerProject.id, restrictedOff.id, consumerCookie);
  assert.equal(stateOff.task.lastRun.status, 'completed');
  const skillsCmdOff = await json(await consumerReq(`/api/projects/${consumerProject.id}/tasks/${restrictedOff.id}/commands`, 'POST', {
    text: '/skills',
    requestId: randomUUID(),
  }), 200);
  assert.equal(skillsCmdOff.result.skills.length, 0, 'Cancelled skill must load zero skills');
  const offRequests = provider.requests.slice(offStartIdx);
  const offSystem = systemTextOf(offRequests);
  const offToolNames = offRequests.flatMap(r => (r.body.tools ?? []).map(tool => tool.function?.name ?? ''));
  assert.equal(offToolNames.includes('read_task_skill'), false, 'Cancelled skill must NOT expose read_task_skill tool');
  assert.equal(offSystem.includes(builtInSkillPath), false, 'Cancelled skill must not deliver built-in SKILL.md');
  assert.equal(offSystem.includes('2.0.0-candidate.1'), false, 'Cancelled skill must not claim 2.0.0-candidate.1 enabled');

  // 3. Ordinary (non-member-pack) project contrast with default Skill enabled
  await json(await host.request('/api/studio/enterprises', 'POST', { requestId: randomUUID(), name: '普通对照企业（无会员包）' }), 201);
  const ordProjRes = await host.request('/api/projects', 'POST', { name: '普通项目对照' });
  const { project: ordinaryProj } = await json(ordProjRes, 201);
  const ordinaryCookie = ordProjRes.headers.get('set-cookie')?.split(';')[0];
  const { task: ordinaryTask } = await json(await host.request(`/api/projects/${ordinaryProj.id}/tasks`, 'POST', {
    name: '普通项目默认 Skill',
    assignment: makeTaskAssignment('analysis', true),
  }), 201);
  const ordOpen = await json(await host.request(`/api/projects/${ordinaryProj.id}/tasks/${ordinaryTask.id}/open`, 'POST', {}), 200);
  assert.equal(ordOpen.snapshot.capabilities.skills, true);
  const ordStartIdx = provider.requests.length;
  await json(await host.request(`/api/projects/${ordinaryProj.id}/tasks/${ordinaryTask.id}/messages`, 'POST', {
    text: '普通项目默认 Skill 对照测试。',
    requestId: randomUUID(),
  }), 202);
  const ordState = await waitTaskSettled(host, ordinaryProj.id, ordinaryTask.id, ordinaryCookie);
  assert.equal(ordState.task.lastRun.status, 'completed');
  const ordSystem = systemTextOf(provider.requests.slice(ordStartIdx));
  assert.ok(ordSystem.includes(builtInSkillPath), 'Ordinary project must still deliver built-in data-analysis');

  // 4. Generic skill catalog order remains intact (project .pi/skills/deep-research still wins in generic catalog)
  const genericCatalog = projectSkillCatalog(process.cwd(), path.join(consumerProject.rootPath, '020_clean'), path.join(host.dataRoot, 'pi')).skills;
  const catalogDeepResearch = genericCatalog.find(s => s.id === 'deep-research');
  assert.ok(catalogDeepResearch);
  assert.equal(path.resolve(catalogDeepResearch.filePath), path.join(customSkillDir, 'SKILL.md'));
});

test('Item 01 · macOS symlink-alias guard test: evaluateNativeToolCall permits read-only Skill reads across /var -> /private/var while denying write/edit and unauthorized data', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optracall-symlink-guard-'));
  let projects: ProjectStore | undefined;
  t.after(async () => {
    await projects?.close().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  });
  const realVar = path.join(root, 'private', 'var');
  const aliasVar = path.join(root, 'var');
  fs.mkdirSync(realVar, { recursive: true });
  fs.symlinkSync(realVar, aliasVar);

  const dataRoot = path.join(aliasVar, 'data');
  const projectsRoot = path.join(aliasVar, 'projects');
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(projectsRoot, { recursive: true });

  projects = new ProjectStore({ dataRoot, projectsRoot });
  await projects.init();
  const enterpriseScopes = new EnterpriseScopeStore(dataRoot);
  const studio = new StudioStore(dataRoot);
  const feature = createMemberPackFeature({
    dataRoot,
    codeRoot: process.cwd(),
    projects,
    enterpriseScopes,
    studio,
    operations: { run: async (_reqId, _fp, op) => op() },
    readBody: async () => ({}),
    mutate: async op => op(),
    closing: () => false,
    readTaskReply: async () => ({ text: '' }),
  });

  const ent = enterpriseScopes.create({ name: 'macOS 符号链接对照企业' });
  const cfg = { id: 'cfg', name: 'cfg', provider: 'openai-compatible', model: 'm', baseUrl: 'http://127.0.0.1:1/v1', revision: 1 };
  const ownerProj = await projects.create({ name: '权责项目', configuration: cfg });
  const consumerProj = await projects.create({ name: '受限项目', configuration: cfg });
  enterpriseScopes.associateProject(ownerProj.id, ent.id);
  enterpriseScopes.associateProject(consumerProj.id, ent.id);
  const ownerTask = await projects.createTask(ownerProj.id, { name: '权责任务' });
  const sys = studio.create({ enterpriseId: ent.id, name: '体系', projectId: ownerProj.id, taskId: ownerTask.id, goal: 'g', topicTitle: 't' });
  feature.packs.ensurePack({ enterpriseId: ent.id, systemId: sys.id, domain: 'member-operations', name: '测试包' });

  // Confirm consumerProj is in deny-detail mode (0 grants)
  assert.equal(feature.getProjectToolScope(consumerProj.id)?.mode, 'deny-detail');

  // Provision workspace via symlink alias (/var/data/...) while snapshotted Skill path is canonical (/private/var/data/...)
  const workspaceAlias = path.join(aliasVar, 'ws-task-1');
  const realWorkspace = path.join(realVar, 'ws-task-1');
  const realSkillDir = path.join(realWorkspace, 'skills', 'abc123');
  fs.mkdirSync(path.join(realWorkspace, '020_clean'), { recursive: true });
  fs.mkdirSync(path.join(realWorkspace, '060_reports'), { recursive: true });
  fs.mkdirSync(path.join(realSkillDir, 'references'), { recursive: true });
  fs.writeFileSync(path.join(realSkillDir, 'SKILL.md'), '# Pinned Skill\n');
  fs.writeFileSync(path.join(realSkillDir, 'references', 'method.md'), '# Method\n');
  fs.writeFileSync(path.join(realWorkspace, '020_clean', 'orders.csv'), 'order_id\nO1\n');
  fs.writeFileSync(path.join(consumerProj.rootPath, '010_draw', 'raw.csv'), 'secret\n');

  // 1. Canonical /private/var/.../skills/.../SKILL.md read -> ALLOWED even in deny-detail!
  assert.equal(
    feature.evaluateNativeToolCall(consumerProj.id, consumerProj.rootPath, { toolName: 'read', input: { path: path.join(realSkillDir, 'SKILL.md') } }, workspaceAlias).allowed,
    true,
    'Canonical realpath SKILL.md inside workspace skills/ must be readable in deny-detail mode',
  );
  // 2. Symlink alias /var/.../skills/.../references/method.md read -> ALLOWED!
  assert.equal(
    feature.evaluateNativeToolCall(consumerProj.id, consumerProj.rootPath, { toolName: 'read', input: { path: path.join(workspaceAlias, 'skills', 'abc123', 'references', 'method.md') } }, workspaceAlias).allowed,
    true,
    'Alias path references/method.md inside workspace skills/ must be readable in deny-detail mode',
  );
  // 3. ls inside skills/ -> ALLOWED!
  assert.equal(
    feature.evaluateNativeToolCall(consumerProj.id, consumerProj.rootPath, { toolName: 'ls', input: { path: realSkillDir } }, workspaceAlias).allowed,
    true,
  );
  // 4. write/edit inside skills/ -> DENIED (read-only!)
  const writeSkill = feature.evaluateNativeToolCall(consumerProj.id, consumerProj.rootPath, { toolName: 'write', input: { path: path.join(realSkillDir, 'SKILL.md'), content: 'tamper' } }, workspaceAlias);
  assert.equal(writeSkill.allowed, false);
  assert.match(writeSkill.reason ?? '', /member_pack_skill_readonly/);
  const editSkill = feature.evaluateNativeToolCall(consumerProj.id, consumerProj.rootPath, { toolName: 'edit', input: { path: path.join(realSkillDir, 'SKILL.md') } }, workspaceAlias);
  assert.equal(editSkill.allowed, false);
  assert.match(editSkill.reason ?? '', /member_pack_skill_readonly/);
  // 5. Unauthorized 020_clean, 010_draw, and outside workspace -> DENIED!
  assert.equal(
    feature.evaluateNativeToolCall(consumerProj.id, consumerProj.rootPath, { toolName: 'read', input: { path: path.join(realWorkspace, '020_clean', 'orders.csv') } }, workspaceAlias).allowed,
    false,
  );
  assert.equal(
    feature.evaluateNativeToolCall(consumerProj.id, consumerProj.rootPath, { toolName: 'read', input: { path: path.join(consumerProj.rootPath, '010_draw', 'raw.csv') } }, workspaceAlias).allowed,
    false,
  );
  assert.equal(
    feature.evaluateNativeToolCall(consumerProj.id, consumerProj.rootPath, { toolName: 'read', input: { path: '/etc/hosts' } }, workspaceAlias).allowed,
    false,
  );

  // 6. allow-detail mode across /var -> /private/var symlink alias: bash/codemode MUST allow authorized CSV and deny unauthorized CSV & realProjectRoot!
  fs.writeFileSync(path.join(consumerProj.rootPath, '020_clean', 'orders.csv'), 'order_id,store,order_date\nO1,甲店,2026-06-05\n');
  fs.writeFileSync(path.join(consumerProj.rootPath, '020_clean', 'unlisted_extra.csv'), 'member_id\nM999\n');
  feature.grants.grant({
    enterpriseId: ent.id,
    grantor: '权责项目',
    grantorProjectId: ownerProj.id,
    grantorSystemId: sys.id,
    grantorTaskId: ownerTask.id,
    grantBasis: 'symlink bash allow-detail check',
    subjectType: 'project',
    subjectId: consumerProj.id,
    resourceKind: 'detail',
    operations: ['read-detail-recalculate'],
    purposeKeys: ['store_30d_repurchase'],
    scope: { stores: ['甲店'], periodFrom: '2026-06-01', periodTo: '2026-07-31', allowedDataPaths: ['020_clean/orders.csv'] },
  });
  assert.equal(feature.getProjectToolScope(consumerProj.id)?.mode, 'allowlist');
  assert.equal(
    feature.evaluateNativeToolCall(consumerProj.id, consumerProj.rootPath, { toolName: 'bash', input: { command: 'python3 -c "print(open(\'orders.csv\').read())"' } }, workspaceAlias).allowed,
    true,
    'bash on authorized orders.csv must be allowed across /var -> /private/var symlink alias',
  );
  assert.equal(
    feature.evaluateNativeToolCall(consumerProj.id, consumerProj.rootPath, { toolName: 'bash', input: { command: 'cat unlisted_extra.csv' } }, workspaceAlias).allowed,
    false,
    'bash on unauthorized unlisted_extra.csv must be denied across /var -> /private/var symlink alias',
  );
  const realConsumerRoot = fs.realpathSync(consumerProj.rootPath);
  assert.equal(
    feature.evaluateNativeToolCall(consumerProj.id, consumerProj.rootPath, { toolName: 'codemode', input: { code: `fs.readFileSync(${JSON.stringify(realConsumerRoot + '/020_clean/orders.csv')})` } }, workspaceAlias).allowed,
    false,
    'codemode referencing canonical realProjectRoot must be denied',
  );
});

test('Item 04 · pack-upsert-purpose returns safe field diagnostics, rejects plural evidenceNotes, guarantees zero write on invalid input, and supports excluding erroneous draft U-02 from preview/publication', { timeout: 60_000 }, async t => {
  const provider = await startToolProvider();
  t.after(() => provider.close());
  const host = await startTestHost();
  t.after(() => host.close());

  const { enterpriseId, ownerProject, system, pack, boundOwnerReq } = await seedRestrictedMemberPackScenario(host, provider.baseUrl);
  const basePurpose = {
    purposeKey: 'store_30d_repurchase',
    title: '甲乙两店 6 月会员 30 日复购率',
    businessQuestion: '截至 7 月 31 日，甲乙两店 6 月首购会员 30 天复购率表现如何？',
    subjectUnit: 'brand_account',
    windowDays: 30,
    scope: { brand: '雅澜服饰', channel: '直营门店', stores: ['甲店', '乙店'], period: '2026-06..2026-07', scopeKey: 'yalan:direct:甲店/乙店:2026-06:30d' },
    tier: 'definition-reference',
    businessStatus: 'active',
    originalGoal: '核定甲乙两店 30 日复购口径',
    remainingGaps: [],
    exclusions: ['全额退款订单不计入有效购买'],
    completionCriteria: '口径与样算复核一致',
  };

  // Seed valid U-01 first
  const u1Res = await json(await boundOwnerReq(`/api/studio/enterprise-packs/${pack.id}/purposes`, 'POST', {
    requestId: randomUUID(),
    projectId: ownerProject.id,
    ...basePurpose,
  }), 200);
  assert.equal(u1Res.purpose.id, 'U-01');
  const revBeforeInvalid = u1Res.pack.revision as number;

  // 1. Missing title -> safe path payload.title, zero write
  const missingTitleRes = await boundOwnerReq(`/api/studio/enterprise-packs/${pack.id}/purposes`, 'POST', {
    requestId: randomUUID(),
    projectId: ownerProject.id,
    ...basePurpose,
    title: '',
  });
  const missingTitle = await json(missingTitleRes, 400);
  assert.equal(missingTitle.details?.issues?.[0]?.path, 'payload.title');
  assert.match(missingTitle.message, /payload\.title/);

  // 2. Missing scope.scopeKey -> safe path payload.scope.scopeKey, zero write
  const missingScopeKeyRes = await boundOwnerReq(`/api/studio/enterprise-packs/${pack.id}/purposes`, 'POST', {
    requestId: randomUUID(),
    projectId: ownerProject.id,
    ...basePurpose,
    scope: { brand: '雅澜服饰', scopeKey: '   ' },
  });
  const missingScopeKey = await json(missingScopeKeyRes, 400);
  assert.equal(missingScopeKey.details?.issues?.[0]?.path, 'payload.scope.scopeKey');
  assert.match(missingScopeKey.message, /payload\.scope\.scopeKey/);

  // 3. Title exceeding 300 UTF-8 bytes -> safe path payload.title & UTF-8 byte unit, zero write
  const tooLongTitleRes = await boundOwnerReq(`/api/studio/enterprise-packs/${pack.id}/purposes`, 'POST', {
    requestId: randomUUID(),
    projectId: ownerProject.id,
    ...basePurpose,
    title: '超长标题'.repeat(40), // 480 UTF-8 bytes > 300
  });
  const tooLongTitle = await json(tooLongTitleRes, 400);
  assert.equal(tooLongTitle.details?.issues?.[0]?.path, 'payload.title');
  assert.match(tooLongTitle.message, /300.*UTF-8/i);

  // 4. Wrong type evidenceNote -> safe path payload.evidenceNote & expected object shape
  const badNoteRes = await boundOwnerReq(`/api/studio/enterprise-packs/${pack.id}/purposes`, 'POST', {
    requestId: randomUUID(),
    projectId: ownerProject.id,
    targetPurposeId: 'U-01',
    ...basePurpose,
    evidenceNote: '错把对象写成纯字符串',
  });
  const badNote = await json(badNoteRes, 400);
  assert.equal(badNote.details?.issues?.[0]?.path, 'payload.evidenceNote');
  assert.match(badNote.message, /payload\.evidenceNote/);

  // 5. Plural misspelling evidenceNotes MUST NOT silently succeed!
  const pluralNoteRes = await boundOwnerReq(`/api/studio/enterprise-packs/${pack.id}/purposes`, 'POST', {
    requestId: randomUUID(),
    projectId: ownerProject.id,
    targetPurposeId: 'U-01',
    ...basePurpose,
    evidenceNotes: [{ projectId: ownerProject.id, note: '误用复数键名', sourceRefs: [] }],
  });
  const pluralNote = await json(pluralNoteRes, 400);
  assert.equal(pluralNote.details?.issues?.[0]?.path, 'payload.evidenceNotes');
  assert.match(pluralNote.message, /evidenceNote/);

  // 6. Limited-calculation without limitedCalculationName -> safe path & condition
  const limitedMissingRes = await boundOwnerReq(`/api/studio/enterprise-packs/${pack.id}/purposes`, 'POST', {
    requestId: randomUUID(),
    projectId: ownerProject.id,
    ...basePurpose,
    tier: 'limited-calculation',
  });
  const limitedMissing = await json(limitedMissingRes, 400);
  assert.equal(limitedMissing.details?.issues?.[0]?.path, 'payload.limitedCalculationName');
  assert.match(limitedMissing.message, /limitedCalculationName/);

  // Confirm zero writes occurred across all 6 invalid requests (pack.revision unchanged!)
  const afterInvalidPack = (await json(await boundOwnerReq(`/api/studio/enterprise-packs/${pack.id}?enterpriseId=${enterpriseId}&projectId=${ownerProject.id}`), 200)).pack;
  assert.equal(afterInvalidPack.revision, revBeforeInvalid, 'Invalid upsertPurpose calls must perform zero writes');
  assert.equal(afterInvalidPack.purposes.length, 1);

  // 7. Fix payload per diagnostic hint -> updates original U-01 once, note readable back
  const fixedRes = await json(await boundOwnerReq(`/api/studio/enterprise-packs/${pack.id}/purposes`, 'POST', {
    requestId: randomUUID(),
    projectId: ownerProject.id,
    targetPurposeId: 'U-01',
    ...basePurpose,
    evidenceNote: { projectId: ownerProject.id, note: '已按单数 evidenceNote 保存核验备注', sourceRefs: [] },
  }), 200);
  assert.equal(fixedRes.created, false);
  assert.equal(fixedRes.purpose.id, 'U-01');
  assert.equal(fixedRes.pack.revision, revBeforeInvalid + 1);
  assert.equal(fixedRes.purpose.evidenceNotes.length, 1);
  assert.equal(fixedRes.purpose.evidenceNotes[0].note, '已按单数 evidenceNote 保存核验备注');

  // 8. Create an erroneous extra draft U-02, exclude U-02 from preview, verify preview & publication contain ONLY U-01 while U-02 & history stay intact
  const u2Res = await json(await boundOwnerReq(`/api/studio/enterprise-packs/${pack.id}/purposes`, 'POST', {
    requestId: randomUUID(),
    projectId: ownerProject.id,
    ...basePurpose,
    purposeKey: 'trial_probe_draft',
    title: '试探误建草案 U-02',
    scope: { brand: '雅澜服饰', channel: '直营门店', period: '2026-06', scopeKey: 'yalan:probe:u02' },
  }), 200);
  assert.equal(u2Res.purpose.id, 'U-02');

  const excludeRes = await json(await boundOwnerReq(`/api/studio/enterprise-packs/${pack.id}/purposes/U-02/preview-exclusion`, 'POST', {
    requestId: randomUUID(),
    projectId: ownerProject.id,
    excluded: true,
    reason: '试探性误建草案，排除出发布预览但保留历史',
  }), 200);
  const u2AfterExclude = excludeRes.pack.purposes.find((p: any) => p.id === 'U-02');
  assert.equal(u2AfterExclude.excludedFromPreview, true);

  // Prepare preview with only U-01 and confirm publication v1.0
  const previewRes = await json(await boundOwnerReq(`/api/studio/enterprise-packs/${pack.id}/previews`, 'POST', {
    requestId: randomUUID(),
    projectId: ownerProject.id,
    version: '1.0',
    purposeIds: ['U-01'],
    summary: '仅纳入正式用途 U-01 的首版预览',
  }), 200);
  assert.deepEqual(previewRes.preview.purposeSnapshots.map((p: any) => p.purposeId), ['U-01']);

  const confirmRes = await json(await boundOwnerReq(`/api/studio/enterprise-packs/${pack.id}/confirm`, 'POST', {
    requestId: randomUUID(),
    projectId: ownerProject.id,
    previewId: previewRes.preview.id,
    fingerprint: previewRes.preview.fingerprint,
    confirmedBy: '雅澜会员运营负责人',
  }), 200);
  assert.deepEqual(confirmRes.revision.purposeManifests.map((p: any) => p.purposeId), ['U-01']);
  assert.equal(confirmRes.pack.purposes.some((p: any) => p.id === 'U-02'), true, 'Excluded U-02 must stay preserved in pack history');

  // Verify real studio_assets tool path also surfaces safe field path (not bare invalid_studio_text) when Agent calls pack-upsert-purpose
  const constructionTask = (await json(await boundOwnerReq(`/api/studio/systems/${system.id}`), 200)).task;
  let toolTurn = 0;
  provider.setResponder(ctx => {
    toolTurn += 1;
    if (toolTurn === 1) {
      return {
        calls: [{
          name: 'studio_assets',
          arguments: {
            action: 'pack-upsert-purpose',
            systemId: system.id,
            payload: {
              ...basePurpose,
              targetPurposeId: 'U-01',
              evidenceNotes: [{ projectId: ownerProject.id, note: '错拼复数键名', sourceRefs: [] }],
            },
          },
        }],
      };
    }
    const toolErr = ctx.recentToolResults.map(m => providerMessageText(m.content)).join('\n');
    return { text: `TOOL_ERR:${toolErr}` };
  });
  await json(await boundOwnerReq(`/api/projects/${ownerProject.id}/tasks/${constructionTask.id}/messages`, 'POST', {
    text: '请验证 pack-upsert-purpose 的字段错误回包。',
    requestId: randomUUID(),
    studioContext: { systemId: system.id, purpose: 'construction' },
  }), 202);
  const toolState = await waitTaskSettled(host, ownerProject.id, constructionTask.id, undefined);
  const lastReply = providerMessageText(toolState.snapshot.messages.at(-1)?.content);
  assert.match(lastReply, /payload\.evidenceNotes/);
  assert.match(lastReply, /evidenceNote/);

  // 9. ZERO-WRITE on brand-new enterprise with 0 packs: invalid studio_assets pack-upsert-purpose (empty title) must NOT create an empty pack!
  const emptyEnt = await json(await boundOwnerReq('/api/studio/enterprises', 'POST', { requestId: randomUUID(), name: '零包企业防空建测试' }), 201);
  const { project: emptyProj } = await json(await boundOwnerReq('/api/projects', 'POST', { name: '零包建设项目' }), 201);
  await json(await boundOwnerReq('/api/studio/enterprise-associations', 'POST', {
    requestId: randomUUID(), kind: 'project', entityId: emptyProj.id, enterpriseId: emptyEnt.id,
  }), 200);
  const bindEmpty = await boundOwnerReq(`/api/projects/${emptyProj.id}`);
  const emptyCookie = bindEmpty.headers.get('set-cookie')!.split(';')[0]!;
  const emptyReq = (route: string, method = 'GET', body?: unknown) =>
    fetch(host.baseUrl + route, { method, headers: { ...host.headers, cookie: emptyCookie }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const { system: emptySys } = await json(await emptyReq('/api/studio/systems', 'POST', {
    requestId: randomUUID(), enterpriseId: emptyEnt.id, name: '零包体系', projectId: emptyProj.id, goal: '防空包测试', topicTitle: '防空包',
  }), 201);
  const emptyConstructionTask = (await json(await emptyReq(`/api/studio/systems/${emptySys.id}`), 200)).task;
  let emptyTurn = 0;
  provider.setResponder(ctx => {
    emptyTurn += 1;
    if (emptyTurn === 1) {
      return {
        calls: [{
          name: 'studio_assets',
          arguments: {
            action: 'pack-upsert-purpose',
            systemId: emptySys.id,
            payload: { ...basePurpose, title: '' },
          },
        }],
      };
    }
    return { text: `EMPTY_ERR:${ctx.recentToolResults.map(m => providerMessageText(m.content)).join('\n')}` };
  });
  await json(await emptyReq(`/api/projects/${emptyProj.id}/tasks/${emptyConstructionTask.id}/messages`, 'POST', {
    text: '测试空标题用途提交不应新建空包。',
    requestId: randomUUID(),
    studioContext: { systemId: emptySys.id, purpose: 'construction' },
  }), 202);
  const emptyToolState = await waitTaskSettled(host, emptyProj.id, emptyConstructionTask.id, emptyCookie);
  assert.match(providerMessageText(emptyToolState.snapshot.messages.at(-1)?.content), /payload\.title/);
  const packsAfterEmptyErr = await json(await emptyReq(`/api/studio/enterprise-packs?enterpriseId=${emptyEnt.id}&domain=member-operations&projectId=${emptyProj.id}`), 200);
  assert.equal(packsAfterEmptyErr.packs.length, 0, 'Invalid pack-upsert-purpose on 0-pack enterprise must create ZERO empty packs');

  // 10. ZERO-WRITE on continuation project after original owner project is archived: invalid POST /purposes must NOT bump revision, record continuation, or change activeOwnerProjectId!
  const { project: contProj } = await json(await boundOwnerReq('/api/projects', 'POST', { name: '同企业接续建设项目' }), 201);
  await json(await boundOwnerReq('/api/studio/enterprise-associations', 'POST', {
    requestId: randomUUID(), kind: 'project', entityId: contProj.id, enterpriseId,
  }), 200);
  await json(await boundOwnerReq(`/api/projects/${ownerProject.id}/archive`, 'POST', {}), 200);
  const bindCont = await boundOwnerReq(`/api/projects/${contProj.id}`);
  const contCookie = bindCont.headers.get('set-cookie')!.split(';')[0]!;
  const contReq = (route: string, method = 'GET', body?: unknown) =>
    fetch(host.baseUrl + route, { method, headers: { ...host.headers, cookie: contCookie }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const beforeContPack = (await json(await contReq(`/api/studio/enterprise-packs/${pack.id}?enterpriseId=${enterpriseId}&projectId=${contProj.id}`), 200)).pack;
  const revBeforeContInvalid = beforeContPack.revision as number;
  const contCountBefore = (beforeContPack.continuationHistory ?? []).length;
  const activeOwnerBefore = beforeContPack.activeOwnerProjectId ?? null;

  const invalidContRes = await contReq(`/api/studio/enterprise-packs/${pack.id}/purposes`, 'POST', {
    requestId: randomUUID(),
    projectId: contProj.id,
    ...basePurpose,
    title: '',
  });
  const invalidContBody = await json(invalidContRes, 400);
  assert.equal(invalidContBody.details?.issues?.[0]?.path, 'payload.title');
  const afterContInvalid = (await json(await contReq(`/api/studio/enterprise-packs/${pack.id}?enterpriseId=${enterpriseId}&projectId=${contProj.id}`), 200)).pack;
  assert.equal(afterContInvalid.revision, revBeforeContInvalid, 'Invalid continuation purpose submit must NOT bump pack revision');
  assert.equal((afterContInvalid.continuationHistory ?? []).length, contCountBefore, 'Invalid continuation purpose submit must NOT record a continuation');
  assert.equal(afterContInvalid.activeOwnerProjectId ?? null, activeOwnerBefore, 'Invalid continuation purpose submit must NOT change activeOwnerProjectId');

  // Valid continuation retry succeeds and records exactly 1 continuation!
  const validContRes = await json(await contReq(`/api/studio/enterprise-packs/${pack.id}/purposes`, 'POST', {
    requestId: randomUUID(),
    projectId: contProj.id,
    targetPurposeId: 'U-01',
    ...basePurpose,
    title: '甲乙两店 6 月会员 30 日复购率（接续修订）',
  }), 200);
  assert.equal(validContRes.pack.activeOwnerProjectId, contProj.id);
  assert.equal((validContRes.pack.continuationHistory ?? []).length, contCountBefore + 1);
});

test('Item 03 · Pre-acceptance 409 returns accepted:false keeping draft intact; acceptance atomically clears matching draft without wiping newer drafts', { timeout: 45_000 }, async t => {
  const provider = await startToolProvider();
  t.after(() => provider.close());
  const host = await startTestHost();
  t.after(() => host.close());

  await json(await host.request('/api/configuration', 'PUT', {
    name: 'Item03 Synthetic',
    provider: 'openai-compatible',
    baseUrl: provider.baseUrl,
    model: 'synthetic-03',
    apiKey: 'synthetic-only',
  }), 200);
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '前置失败草稿项目' }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', {
    name: '前置失败任务',
    assignment: makeTaskAssignment('analysis', true),
  }), 201);

  const multilinePrompt = '第一行：截至 7 月 31 日，核对甲乙两店 6 月会员 30 天复购。\n第二行：列出分子、分母和全额退款排除项。';
  await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}/draft`, 'PATCH', { text: multilinePrompt }), 200);

  // 1. Pre-acceptance 409 (project_archived) -> accepted:false, draft intact, 0 native messages
  await json(await host.request(`/api/projects/${project.id}/archive`, 'POST', {}), 200);
  const rejectedRes = await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', {
    text: multilinePrompt,
    requestId: randomUUID(),
  });
  const rejected = await json(rejectedRes, 409);
  assert.equal(rejected.accepted, false, 'Pre-acceptance 409 on /messages MUST return accepted: false');

  await json(await host.request(`/api/projects/${project.id}/restore`, 'POST', {}), 200);
  const taskRead = await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}`), 200);
  assert.equal(taskRead.task.draft, multilinePrompt, 'Original multiline draft must remain intact on disk');
  assert.equal(taskRead.snapshot.messages.length, 0, 'Failed pre-acceptance prompt must not appear as a native sent message');

  // 2. Acceptance atomically clears task.draft on Host when draft === sent text (even without client PATCH /draft "")
  const acceptRes = await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', {
    text: multilinePrompt,
    requestId: randomUUID(),
  });
  await json(acceptRes, 202);
  const settled1 = await waitTaskSettled(host, project.id, task.id);
  assert.equal(settled1.task.draft, '', 'Host must atomically clear matching task.draft upon acceptance so refresh cannot duplicate-send');
  const userMessages1 = settled1.snapshot.messages.filter((m: any) => m.role === 'user');
  assert.equal(userMessages1.length, 1, 'Accepted send must create strictly 1 native user message');

  // 3. Acceptance must NOT wipe a different newer draft saved on Host
  await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}/draft`, 'PATCH', { text: '保留中的较新草稿-2' }), 200);
  await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', {
    text: '另一条显式发送文本',
    requestId: randomUUID(),
  }), 202);
  const settled2 = await waitTaskSettled(host, project.id, task.id);
  assert.equal(settled2.task.draft, '保留中的较新草稿-2', 'Host must preserve a different newer draft when accepting another message');
});

test('Item 05 · Named maintainer guidance, cross-browser re-auth, summary/wrong-purpose denials, dynamic CSV 3-file recalculate (2/3), revocation, and ephemeral historical preservation', { timeout: 90_000 }, async t => {
  const provider = await startToolProvider();
  t.after(() => provider.close());
  const host = await startTestHost();
  t.after(() => host.close());

  const { enterpriseId, ownerProject, consumerProject, system, pack, boundOwnerReq, consumerReq, consumerCookie } = await seedRestrictedMemberPackScenario(host, provider.baseUrl);

  // Create a verified enterprise-material summary asset for summary-only grant contrast
  const { material: createdSummary } = await json(await boundOwnerReq('/api/enterprise-materials', 'POST', {
    title: '6月甲乙两店复购月度汇总',
    body: JSON.stringify({ grain: 'store-month', period: '2026-06..2026-07', note: '汇总视图，不含逐笔明细' }),
  }), 201);
  const { material: enabledSummary, storeId: summaryStoreId } = await json(
    await boundOwnerReq(`/api/enterprise-materials/${createdSummary.id}/enable`, 'POST', { expectedVersion: createdSummary.version }),
    200,
  );
  await json(await boundOwnerReq('/api/studio/enterprise-associations', 'POST', {
    requestId: randomUUID(), enterpriseId, kind: 'asset', entityId: createdSummary.id, authority: 'enterprise',
  }), 200);
  const summaryRev = enabledSummary.revisions[0];
  const summaryRef = {
    authority: 'enterprise',
    id: createdSummary.id,
    version: summaryRev.revisionId,
    sha256: summaryRev.bodySha256,
    locator: summaryStoreId,
  };

  // Publish v1.0 with purpose store_30d_repurchase
  await json(await boundOwnerReq(`/api/studio/enterprise-packs/${pack.id}/purposes`, 'POST', {
    requestId: randomUUID(),
    projectId: ownerProject.id,
    purposeKey: 'store_30d_repurchase',
    title: '甲乙两店 6 月会员 30 日复购率',
    businessQuestion: '截至 7 月 31 日，甲乙两店 6 月会员 30 天复购表现如何？',
    subjectUnit: 'brand_account',
    windowDays: 30,
    scope: { brand: '雅澜服饰', channel: '直营门店', stores: ['甲店', '乙店'], period: '2026-06..2026-07', scopeKey: 'yalan:甲店/乙店:2026-06:30d' },
    tier: 'definition-reference',
    businessStatus: 'active',
    originalGoal: '核定复购口径并支持获准明细重算',
    remainingGaps: [],
    exclusions: ['全额退款排除'],
    completionCriteria: '口径一致',
  }), 200);
  const prevRes = await json(await boundOwnerReq(`/api/studio/enterprise-packs/${pack.id}/previews`, 'POST', {
    requestId: randomUUID(), projectId: ownerProject.id, version: '1.0', purposeIds: ['U-01'], summary: 'v1.0',
  }), 200);
  await json(await boundOwnerReq(`/api/studio/enterprise-packs/${pack.id}/confirm`, 'POST', {
    requestId: randomUUID(), projectId: ownerProject.id, previewId: prevRes.preview.id, fingerprint: prevRes.preview.fingerprint, confirmedBy: '雅澜会员运营负责人',
  }), 200);

  // 1. Register a second operator (non-owner) in a separate browser context, open ownerProject -> read-only + actionable guidance (no credentials!)
  const otherOpRes = await fetch(`${host.baseUrl}/api/studio/operators/session`, {
    method: 'POST',
    headers: host.headers,
    body: JSON.stringify({ action: 'register', operatorId: 'other-analyst', displayName: '外部观察员', passcode: 'other-2026', activeProjectId: ownerProject.id }),
  });
  await json(otherOpRes, 200);
  const otherCookie = otherOpRes.headers.get('set-cookie')!.split(';')[0]!;
  const otherPackRes = await json(await fetch(`${host.baseUrl}/api/studio/enterprise-packs?enterpriseId=${enterpriseId}&domain=member-operations&projectId=${ownerProject.id}`, {
    headers: { ...host.headers, cookie: otherCookie },
  }), 200);
  assert.equal(otherPackRes.grantAuthority, undefined, 'Non-owner operator must not receive grantAuthority');
  assert.ok(otherPackRes.grantAuthorityGuidance, 'Blocked user must receive safe grantAuthorityGuidance');
  assert.equal(otherPackRes.grantAuthorityGuidance.authorized, false);
  assert.equal(otherPackRes.grantAuthorityGuidance.maintainerType, 'named-operator');
  assert.equal(otherPackRes.grantAuthorityGuidance.maintainerOperatorId, 'op:yalan-ops');
  assert.equal(otherPackRes.grantAuthorityGuidance.maintainerDisplayName, '雅澜会员运营负责人');
  assert.equal(otherPackRes.grantAuthorityGuidance.ownerProjectName, '雅澜会员建设权责项目');
  assert.equal(otherPackRes.grantAuthorityGuidance.reason, 'wrong_operator');
  assert.ok(!JSON.stringify(otherPackRes.grantAuthorityGuidance).includes('yalan-2026'), 'Guidance must never expose credentials');

  // 2. Fresh "Browser 2" context: same maintainer re-authenticates via login, binds to ownerProject, gets grantAuthority
  const b2Login = await fetch(`${host.baseUrl}/api/studio/operators/session`, {
    method: 'POST',
    headers: host.headers,
    body: JSON.stringify({ action: 'login', operatorId: 'yalan-ops', passcode: 'yalan-2026', activeProjectId: ownerProject.id }),
  });
  await json(b2Login, 200);
  const b2Cookie = b2Login.headers.get('set-cookie')!.split(';')[0]!;
  const b2Pack = await json(await fetch(`${host.baseUrl}/api/studio/enterprise-packs?enterpriseId=${enterpriseId}&domain=member-operations&projectId=${ownerProject.id}`, {
    headers: { ...host.headers, cookie: b2Cookie },
  }), 200);
  assert.ok(b2Pack.grantAuthority?.authorityToken, 'Re-authenticated maintainer in Browser 2 must receive grantAuthority');
  assert.equal(b2Pack.grantAuthorityGuidance?.authorized, true);

  // Place 3 synthetic detail CSV files + 1 unlisted file in consumerProject 020_clean/
  const membersCsv = [
    'member_id,store,order_date,cohort_month',
    'M001,甲店,2026-06-05,2026-06',
    'M002,甲店,2026-06-10,2026-06',
    'M003,乙店,2026-06-12,2026-06',
    'M004,丙店,2026-06-15,2026-06',
  ].join('\n') + '\n';
  const ordersCsv = [
    'order_id,member_id,store,order_date,amount',
    'O01,M001,甲店,2026-06-05,300',
    'O02,M001,甲店,2026-06-25,280',
    'O03,M002,甲店,2026-06-10,200',
    'O04,M002,甲店,2026-07-02,220',
    'O05,M003,乙店,2026-06-12,400',
    'O06,M003,乙店,2026-07-05,350',
    'O07,M004,丙店,2026-06-15,500',
    'O08,M001,甲店,2026-08-10,199',
  ].join('\n') + '\n';
  const refundsCsv = [
    'refund_id,order_id,store,order_date,full_refund',
    'R01,O04,甲店,2026-07-04,true',
    'R02,O07,丙店,2026-06-18,true',
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(consumerProject.rootPath, '020_clean', 'members.csv'), membersCsv);
  fs.writeFileSync(path.join(consumerProject.rootPath, '020_clean', 'orders.csv'), ordersCsv);
  fs.writeFileSync(path.join(consumerProject.rootPath, '020_clean', 'refunds.csv'), refundsCsv);
  fs.writeFileSync(path.join(consumerProject.rootPath, '020_clean', 'unlisted_extra.csv'), 'member_id,store,order_date\nM999,甲店,2026-06-15\n');

  // 3. Positive/negative contrast A: cite-summary grant ONLY -> all 3 detail CSV reads MUST be denied 403!
  const summaryGrant = await json(await fetch(`${host.baseUrl}/api/studio/resource-grants`, {
    method: 'POST',
    headers: { ...host.headers, cookie: b2Cookie },
    body: JSON.stringify({
      requestId: randomUUID(),
      enterpriseId,
      grantorProjectId: b2Pack.grantAuthority.ownerProjectId,
      grantorSystemId: b2Pack.grantAuthority.systemId,
      grantorTaskId: b2Pack.grantAuthority.ownerTaskId,
      authorityToken: b2Pack.grantAuthority.authorityToken,
      grantBasis: '仅汇总授权对照',
      subjectType: 'project',
      subjectId: consumerProject.id,
      resourceKind: 'summary',
      operations: ['cite-summary'],
      purposeKeys: ['store_30d_repurchase'],
      scope: {
        stores: ['甲店', '乙店'],
        periodFrom: '2026-06-01',
        periodTo: '2026-07-31',
        grain: 'store-month',
        summaryAssetId: summaryRef.id,
        summaryVersion: summaryRef.version,
      },
      resourceRef: summaryRef,
    }),
  }), 200);
  assert.ok(summaryGrant.grant.id);
  for (const csvName of ['members.csv', 'orders.csv', 'refunds.csv']) {
    const denied = await consumerReq(`/api/projects/${consumerProject.id}/files/content?path=${encodeURIComponent(`020_clean/${csvName}`)}`);
    assert.equal(denied.status, 403, `Summary-only grant must deny reading detail file ${csvName}`);
  }

  // 3b. Positive/negative contrast B: wrong-purpose detail grant (unrelated_purpose) -> detail access for store_30d_repurchase MUST be denied!
  const wrongPurposeGrant = await json(await fetch(`${host.baseUrl}/api/studio/resource-grants`, {
    method: 'POST',
    headers: { ...host.headers, cookie: b2Cookie },
    body: JSON.stringify({
      requestId: randomUUID(),
      enterpriseId,
      grantorProjectId: b2Pack.grantAuthority.ownerProjectId,
      grantorSystemId: b2Pack.grantAuthority.systemId,
      grantorTaskId: b2Pack.grantAuthority.ownerTaskId,
      authorityToken: b2Pack.grantAuthority.authorityToken,
      grantBasis: '错误用途对照授权',
      subjectType: 'project',
      subjectId: consumerProject.id,
      resourceKind: 'detail',
      operations: ['read-detail-recalculate'],
      purposeKeys: ['unrelated_other_purpose'],
      scope: {
        stores: ['甲店', '乙店'],
        periodFrom: '2026-06-01',
        periodTo: '2026-07-31',
        allowedDataPaths: ['020_clean/members.csv', '020_clean/orders.csv', '020_clean/refunds.csv'],
      },
    }),
  }), 200);
  const { task: wrongPurposeTask } = await json(await consumerReq(`/api/projects/${consumerProject.id}/tasks`, 'POST', {
    name: 'T05 错误用途否定对照',
    assignment: makeTaskAssignment('analysis', true),
  }), 201);
  // Pin task to pack v1.0, then attempt read_input for purposeId U-01 (store_30d_repurchase) -> MUST be denied under wrong-purpose detail grant!
  await json(await consumerReq(`/api/studio/enterprise-packs/${pack.id}/pin`, 'POST', {
    requestId: randomUUID(), projectId: consumerProject.id, taskId: wrongPurposeTask.id,
  }), 200);
  let wrongStep = 0;
  let wrongPurposeReadResult = '';
  provider.setResponder(ctx => {
    wrongStep += 1;
    if (wrongStep === 1) {
      return { calls: [{ name: 'read_input', arguments: { filename: 'orders.csv', purposeId: 'U-01' } }] };
    }
    wrongPurposeReadResult = ctx.recentToolResults.map(m => providerMessageText(m.content)).join('\n');
    return { text: '已核对错误用途明细读取结果。' };
  });
  await json(await consumerReq(`/api/projects/${consumerProject.id}/tasks/${wrongPurposeTask.id}/messages`, 'POST', {
    text: '尝试以 U-01 用途读取 orders.csv 验证错误用途授权拦截。',
    requestId: randomUUID(),
  }), 202);
  await waitTaskSettled(host, consumerProject.id, wrongPurposeTask.id, consumerCookie);
  assert.equal(wrongPurposeReadResult.includes('O01,M001'), false, 'Wrong-purpose detail grant must NOT allow reading orders.csv for U-01');
  assert.match(wrongPurposeReadResult, /not_authorized|denied|无权|缺少|403|error/i, `Wrong-purpose read_input must return denial, got: ${wrongPurposeReadResult}`);
  // Revoke wrong-purpose grant before granting exact purpose
  await json(await fetch(`${host.baseUrl}/api/studio/resource-grants/${wrongPurposeGrant.grant.id}/revoke`, {
    method: 'POST',
    headers: { ...host.headers, cookie: b2Cookie },
    body: JSON.stringify({
      requestId: randomUUID(),
      reason: '清理错误用途对照授权',
      revokerProjectId: b2Pack.grantAuthority.ownerProjectId,
      revokerSystemId: b2Pack.grantAuthority.systemId,
      revokerTaskId: b2Pack.grantAuthority.ownerTaskId,
      authorityToken: b2Pack.grantAuthority.authorityToken,
    }),
  }), 200);

  // 4. Grant T05 read-detail-recalculate for EXACT purpose store_30d_repurchase, 甲店/乙店, 2026-06-01..2026-07-31, 3 CSV files
  const detailGrant = await json(await fetch(`${host.baseUrl}/api/studio/resource-grants`, {
    method: 'POST',
    headers: { ...host.headers, cookie: b2Cookie },
    body: JSON.stringify({
      requestId: randomUUID(),
      enterpriseId,
      grantorProjectId: b2Pack.grantAuthority.ownerProjectId,
      grantorSystemId: b2Pack.grantAuthority.systemId,
      grantorTaskId: b2Pack.grantAuthority.ownerTaskId,
      authorityToken: b2Pack.grantAuthority.authorityToken,
      grantBasis: 'T05 甲乙两店 6月队列+7月观察窗三表明细重算授权',
      subjectType: 'project',
      subjectId: consumerProject.id,
      resourceKind: 'detail',
      operations: ['read-definition', 'read-detail-recalculate'],
      purposeKeys: ['store_30d_repurchase'],
      scope: {
        stores: ['甲店', '乙店'],
        periodFrom: '2026-06-01',
        periodTo: '2026-07-31',
        allowedDataPaths: ['020_clean/members.csv', '020_clean/orders.csv', '020_clean/refunds.csv'],
      },
    }),
  }), 200);
  assert.ok(detailGrant.grant.id);

  // 5. Independent new task in T05 reads all 3 authorized files via real Pi SDK read_input and DYNAMICALLY computes from actual returned rows!
  const { task: t05Task } = await json(await consumerReq(`/api/projects/${consumerProject.id}/tasks`, 'POST', {
    name: 'T05 独立明细重算任务',
    assignment: makeTaskAssignment('analysis', true),
  }), 201);
  let step = 0;
  const readContents: Record<string, string> = {};
  let computed: ReturnType<typeof computeStore30dRepurchaseFromRows> | undefined;
  provider.setResponder(ctx => {
    step += 1;
    if (step === 1) {
      return {
        calls: [
          { name: 'read_input', arguments: { filename: 'members.csv' } },
          { name: 'read_input', arguments: { filename: 'orders.csv' } },
          { name: 'read_input', arguments: { filename: 'refunds.csv' } },
          { name: 'read_input', arguments: { filename: 'unlisted_extra.csv' } },
        ],
      };
    }
    const results = ctx.recentToolResults.map(m => providerMessageText(m.content));
    readContents.members = results[0] ?? '';
    readContents.orders = results[1] ?? '';
    readContents.refunds = results[2] ?? '';
    readContents.unlisted = results[3] ?? '';
    readContents.all = results.join('\n---\n');
    computed = computeStore30dRepurchaseFromRows(readContents.members, readContents.orders, readContents.refunds);
    const a = computed.byStore['甲店'] ?? { numerator: 0, denominator: 0 };
    const b = computed.byStore['乙店'] ?? { numerator: 0, denominator: 0 };
    return {
      text: `实读行逐笔重算结果：甲店 ${a.numerator}/${a.denominator}，乙店 ${b.numerator}/${b.denominator}，合计 ${computed.total.numerator}/${computed.total.denominator}（实读行数：members=${computed.memberCount}, orders=${computed.orderCount}, refunds=${computed.refundCount}）。`,
    };
  });
  await json(await consumerReq(`/api/projects/${consumerProject.id}/tasks/${t05Task.id}/messages`, 'POST', {
    text: '请读取获准的三张明细表逐笔重算甲乙两店 6 月会员 30 日复购率并列出分子、分母和排除项。',
    requestId: randomUUID(),
  }), 202);
  const t05State = await waitTaskSettled(host, consumerProject.id, t05Task.id, consumerCookie);
  assert.equal(t05State.task.lastRun.status, 'completed');
  assert.ok(computed, 'Recalculation must run on actual returned CSV rows');
  assert.equal(computed.memberCount, 3, 'Filtered members.csv must have strictly 3 rows (丙店 filtered out)');
  assert.equal(computed.orderCount, 6, 'Filtered orders.csv must have strictly 6 rows (丙店 & 2026-08 filtered out)');
  assert.equal(computed.refundCount, 1, 'Filtered refunds.csv must have strictly 1 row (丙店 filtered out)');
  assert.deepEqual(computed.byStore['甲店'], { denominator: 2, numerator: 1 });
  assert.deepEqual(computed.byStore['乙店'], { denominator: 1, numerator: 1 });
  assert.deepEqual(computed.total, { denominator: 3, numerator: 2 });
  assert.equal(readContents.all.includes('丙店'), false, 'Unauthorized store 丙店 must be filtered out');
  assert.equal(readContents.all.includes('2026-08-10'), false, 'Out-of-period August row must be filtered out');
  assert.equal(readContents.all.includes('M999'), false, 'Unlisted file unlisted_extra.csv must be denied');

  // 6. Revoke detail grant -> consumer project immediately loses detail read eligibility
  await json(await fetch(`${host.baseUrl}/api/studio/resource-grants/${detailGrant.grant.id}/revoke`, {
    method: 'POST',
    headers: { ...host.headers, cookie: b2Cookie },
    body: JSON.stringify({
      requestId: randomUUID(),
      reason: '复核结束撤回明细授权',
      revokerProjectId: b2Pack.grantAuthority.ownerProjectId,
      revokerSystemId: b2Pack.grantAuthority.systemId,
      revokerTaskId: b2Pack.grantAuthority.ownerTaskId,
      authorityToken: b2Pack.grantAuthority.authorityToken,
    }),
  }), 200);
  const deniedAfterRevoke = await consumerReq(`/api/projects/${consumerProject.id}/files/content?path=${encodeURIComponent('020_clean/orders.csv')}`);
  assert.equal(deniedAfterRevoke.status, 403, 'After revoking detail grant, reading 020_clean detail CSV must be denied');

  // 7. Historical pack bound to an ephemeral session:* identity preserves original state & exposes clear governance guidance
  const entHist = await json(await host.request('/api/studio/enterprises', 'POST', { requestId: randomUUID(), name: '历史临时绑定企业' }), 201);
  const histProjRes = await fetch(`${host.baseUrl}/api/projects`, { method: 'POST', headers: host.headers, body: JSON.stringify({ name: '历史临时项目' }) });
  const { project: histProj } = await json(histProjRes, 201);
  const ephemeralCookie = histProjRes.headers.get('set-cookie')!.split(';')[0]!;
  await json(await fetch(`${host.baseUrl}/api/studio/enterprise-associations`, {
    method: 'POST', headers: { ...host.headers, cookie: ephemeralCookie },
    body: JSON.stringify({ requestId: randomUUID(), kind: 'project', entityId: histProj.id, enterpriseId: entHist.id }),
  }), 200);
  const { system: histSys } = await json(await fetch(`${host.baseUrl}/api/studio/systems`, {
    method: 'POST', headers: { ...host.headers, cookie: ephemeralCookie },
    body: JSON.stringify({ requestId: randomUUID(), enterpriseId: entHist.id, name: '历史体系', projectId: histProj.id, goal: '历史测试', topicTitle: '历史' }),
  }), 201);
  await json(await fetch(`${host.baseUrl}/api/studio/enterprise-packs`, {
    method: 'POST', headers: { ...host.headers, cookie: ephemeralCookie },
    body: JSON.stringify({ requestId: randomUUID(), enterpriseId: entHist.id, systemId: histSys.id, projectId: histProj.id, domain: 'member-operations', name: '历史临时包' }),
  }), 200);
  const histBrowser2 = await fetch(`${host.baseUrl}/api/projects/${histProj.id}`, { headers: host.headers });
  const histB2Cookie = histBrowser2.headers.get('set-cookie')!.split(';')[0]!;
  const histPackRes = await json(await fetch(`${host.baseUrl}/api/studio/enterprise-packs?enterpriseId=${entHist.id}&domain=member-operations&projectId=${histProj.id}`, {
    headers: { ...host.headers, cookie: histB2Cookie },
  }), 200);
  assert.equal(histPackRes.grantAuthority, undefined);
  assert.equal(histPackRes.grantAuthorityGuidance?.maintainerType, 'ephemeral-session');
  assert.equal(histPackRes.grantAuthorityGuidance?.reason, 'ephemeral_maintainer_binding');
  assert.match(histPackRes.grantAuthorityGuidance?.nextStep ?? '', /临时浏览器会话|PM\/用户/);
});


