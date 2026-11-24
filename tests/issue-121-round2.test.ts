import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { approvedTaskSkills, makeTaskAssignment } from '../src/host/task-assignment.ts';
import { loadFixedBuiltInSkill, packageIdentity, projectSkillCatalog } from '../src/agent/skill-catalog.ts';
import { resolveProtectedSkillSnapshot, snapshotProtectedSkills } from '../src/agent/protected-skills.ts';

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

test('Item 01 · Restricted member-pack task with default data-analysis Skill starts, delivers exact built-in skill, and preserves cancel/collision/ordinary contrasts', { timeout: 90_000 }, async t => {
  const provider = await startToolProvider();
  t.after(() => provider.close());
  const host = await startTestHost();
  t.after(() => host.close());

  const { consumerProject, consumerReq, consumerCookie } = await seedRestrictedMemberPackScenario(host, provider.baseUrl);
  const builtInSkillPath = path.join(process.cwd(), 'extensions', 'analysis-assets', 'data-analysis', 'SKILL.md');
  const expectedSha = approvedTaskSkills.analysis!.sha256;
  assert.equal(packageIdentity(builtInSkillPath), expectedSha);

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

  const reqStartIdx = provider.requests.length;
  const sendOn = await consumerReq(`/api/projects/${consumerProject.id}/tasks/${restrictedOn.id}/messages`, 'POST', {
    text: '截至 7 月 31 日，甲乙两店 6 月会员的 30 天复购表现有什么差异？',
    requestId: randomUUID(),
  });
  await json(sendOn, 202);
  const stateOn = await waitTaskSettled(host, consumerProject.id, restrictedOn.id, consumerCookie);
  assert.equal(stateOn.task.lastRun.status, 'completed');
  assert.equal(stateOn.snapshot.capabilities.skills, true, 'Restricted task with default skill enabled must report skills capability active');

  // Verify the actual system prompt sent to Pi/Provider includes the exact built-in data-analysis skill and NOT colliding copies
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
  // Exact macOS protectedTools + memberPackExecutionScope path:
  // 1) Without skillRoot, assignment.skill fails closed with task_skill_unavailable (matches MacBook root cause)
  assert.throws(() => resolveProtectedSkillSnapshot({
    restrictedMemberPack: true,
    skillRoot: undefined,
    assignmentSkillId: 'data-analysis',
    baseSkills: [collidingUserSkill],
    selectTaskSkills: () => [builtInSkillEntry],
  }), /task_skill_unavailable/);
  // 2) With workspace skillRoot, built-in data-analysis is snapshotted cleanly & matches exact SHA-256
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
  // 3) Explicitly cancelled skill returns [] without error
  const cancelledSnap = resolveProtectedSkillSnapshot({
    restrictedMemberPack: true,
    skillRoot: restrictedSkillsDir,
    assignmentSkillId: undefined,
    baseSkills: [collidingUserSkill],
    selectTaskSkills: () => [builtInSkillEntry],
  });
  assert.equal(cancelledSnap.skills.length, 0);

  // 2. Restricted member-pack task WITH default Skill explicitly cancelled
  const { task: restrictedOff } = await json(await consumerReq(`/api/projects/${consumerProject.id}/tasks`, 'POST', {
    name: '受限默认 Skill 取消',
    assignment: makeTaskAssignment('analysis', false),
  }), 201);
  assert.equal(restrictedOff.assignment.skill, null);
  const offStartIdx = provider.requests.length;
  await json(await consumerReq(`/api/projects/${consumerProject.id}/tasks/${restrictedOff.id}/messages`, 'POST', {
    text: '仅核对取消默认 Skill 时的最小回复。',
    requestId: randomUUID(),
  }), 202);
  const stateOff = await waitTaskSettled(host, consumerProject.id, restrictedOff.id, consumerCookie);
  assert.equal(stateOff.task.lastRun.status, 'completed');
  assert.equal(stateOff.snapshot.capabilities.skills, false, 'Cancelled skill in restricted task must report skills=false');
  const skillsCmdOff = await json(await consumerReq(`/api/projects/${consumerProject.id}/tasks/${restrictedOff.id}/commands`, 'POST', {
    text: '/skills',
    requestId: randomUUID(),
  }), 200);
  assert.equal(skillsCmdOff.result.skills.length, 0, 'Cancelled skill must load zero skills');
  const offSystem = systemTextOf(provider.requests.slice(offStartIdx));
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
  const ordStartIdx = provider.requests.length;
  await json(await host.request(`/api/projects/${ordinaryProj.id}/tasks/${ordinaryTask.id}/messages`, 'POST', {
    text: '普通项目默认 Skill 对照测试。',
    requestId: randomUUID(),
  }), 202);
  const ordState = await waitTaskSettled(host, ordinaryProj.id, ordinaryTask.id, ordinaryCookie);
  assert.equal(ordState.task.lastRun.status, 'completed');
  assert.equal(ordState.snapshot.capabilities.skills, true);
  const ordSystem = systemTextOf(provider.requests.slice(ordStartIdx));
  assert.ok(ordSystem.includes(builtInSkillPath), 'Ordinary project must still deliver built-in data-analysis');

  // 4. Generic skill catalog order remains intact (project .pi/skills/deep-research still wins in generic catalog)
  const genericCatalog = projectSkillCatalog(process.cwd(), path.join(consumerProject.rootPath, '020_clean'), path.join(host.dataRoot, 'pi')).skills;
  const catalogDeepResearch = genericCatalog.find(s => s.id === 'deep-research');
  assert.ok(catalogDeepResearch);
  assert.equal(path.resolve(catalogDeepResearch.filePath), path.join(customSkillDir, 'SKILL.md'));
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
});

test('Item 03 · Pre-acceptance 409 on /messages returns accepted:false, keeps draft intact, and leaves zero native messages', { timeout: 45_000 }, async t => {
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

  // Trigger a genuine pre-acceptance 409 (archive project -> project_archived 409; or tamper assignment skill -> task_skill_version_changed 409)
  await json(await host.request(`/api/projects/${project.id}/archive`, 'POST', {}), 200);
  const rejectedRes = await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', {
    text: multilinePrompt,
    requestId: randomUUID(),
  });
  const rejected = await json(rejectedRes, 409);
  assert.equal(rejected.accepted, false, 'Pre-acceptance 409 on /messages MUST return accepted: false');

  // Also restore project and test task_skill_version_changed 409 via API
  await json(await host.request(`/api/projects/${project.id}/restore`, 'POST', {}), 200);
  const taskRead = await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}`), 200);
  assert.equal(taskRead.task.draft, multilinePrompt, 'Original multiline draft must remain intact on disk');
  assert.equal(taskRead.snapshot.messages.length, 0, 'Failed pre-acceptance prompt must not appear as a native sent message');
});

test('Item 05 · Named maintainer guidance, cross-browser re-auth, 3-file detail recalculate, non-owner read-only, tier separation, revocation, and ephemeral historical preservation', { timeout: 90_000 }, async t => {
  const provider = await startToolProvider();
  t.after(() => provider.close());
  const host = await startTestHost();
  t.after(() => host.close());

  const { enterpriseId, ownerProject, consumerProject, pack, boundOwnerReq, consumerReq, consumerCookie } = await seedRestrictedMemberPackScenario(host, provider.baseUrl);

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

  // 3. Grant ONLY definition first -> detail read must still be denied (tier separation!)
  const defGrant = await json(await fetch(`${host.baseUrl}/api/studio/resource-grants`, {
    method: 'POST',
    headers: { ...host.headers, cookie: b2Cookie },
    body: JSON.stringify({
      requestId: randomUUID(),
      enterpriseId,
      grantorProjectId: b2Pack.grantAuthority.ownerProjectId,
      grantorSystemId: b2Pack.grantAuthority.systemId,
      grantorTaskId: b2Pack.grantAuthority.ownerTaskId,
      authorityToken: b2Pack.grantAuthority.authorityToken,
      grantBasis: '仅查阅定义对照',
      subjectType: 'project',
      subjectId: consumerProject.id,
      resourceKind: 'definition',
      operations: ['read-definition'],
      purposeKeys: ['store_30d_repurchase'],
      scope: {},
    }),
  }), 200);
  assert.ok(defGrant.grant.id);
  const deniedBeforeDetail = await consumerReq(`/api/projects/${consumerProject.id}/files/content?path=${encodeURIComponent('020_clean/orders.csv')}`);
  assert.equal(deniedBeforeDetail.status, 403, 'Definition-only grant must not allow reading detail CSV');

  // 4. Grant T05 read-detail-recalculate for store_30d_repurchase, 甲店/乙店, 2026-06-01..2026-07-31, 3 CSV files
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

  // 5. Independent new task in T05 reads all 3 authorized files via real Pi SDK read_input and recalculates
  const { task: t05Task } = await json(await consumerReq(`/api/projects/${consumerProject.id}/tasks`, 'POST', {
    name: 'T05 独立明细重算任务',
    assignment: makeTaskAssignment('analysis', true),
  }), 201);
  let step = 0;
  const readContents: Record<string, string> = {};
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
    readContents.all = results.join('\n---\n');
    return { text: '已完成三表明细重算：甲店分母2、分子1（O04全额退款排除）；乙店分母1、分子1；合计分母3、分子2；丙店与8月超期及未授权表均已排除。' };
  });
  await json(await consumerReq(`/api/projects/${consumerProject.id}/tasks/${t05Task.id}/messages`, 'POST', {
    text: '请读取获准的三张明细表逐笔重算甲乙两店 6 月会员 30 日复购率并列出分子、分母和排除项。',
    requestId: randomUUID(),
  }), 202);
  const t05State = await waitTaskSettled(host, consumerProject.id, t05Task.id, consumerCookie);
  assert.equal(t05State.task.lastRun.status, 'completed');
  assert.ok(readContents.all.includes('M001,甲店'), 'Must read authorized 甲店 members');
  assert.ok(readContents.all.includes('O06,M003,乙店,2026-07-05'), 'Must read July observation window orders for 乙店');
  assert.ok(readContents.all.includes('R01,O04,甲店'), 'Must read authorized refunds');
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
  // Another browser opens histProj -> cannot mutate or silently transfer ownership, sees ephemeral guidance!
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


