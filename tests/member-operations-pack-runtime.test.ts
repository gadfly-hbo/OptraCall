import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { startLegacyTestHost, startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { withCaseGoal } from './fixtures/case-goal.ts';
import { CaseStore } from '../src/host/case-store.ts';
import type { CaseDecisionReference } from '../src/host/case-decision-types.ts';

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

async function json(response: Response, status = 200): Promise<any> {
  const text = await response.clone().text();
  assert.equal(response.status, status, `Expected ${status}, got ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function waitIdle(host: Awaited<ReturnType<typeof startTestHost>>, projectId: string, taskId: string, minMessages = 0) {
  const route = `/api/projects/${projectId}/tasks/${taskId}`;
  const started = Date.now();
  while (Date.now() - started < 45_000) {
    const response = await host.request(route);
    if (response.status === 409 && (await response.clone().json()).code === 'session_history_unavailable') {
      await new Promise(resolve => setTimeout(resolve, 30));
      continue;
    }
    const state = await json(response);
    if (
      state.task.lastRun?.status === 'completed'
      && state.snapshot.status === 'idle'
      && state.snapshot.messages.length >= minMessages
    ) {
      return state;
    }
    if (state.task.lastRun?.status === 'failed' || state.task.lastRun?.status === 'cancelled') {
      throw new Error(`Task ended with ${state.task.lastRun.status}: ${JSON.stringify(state.task.lastRun)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Timed out waiting for task completion');
}

test('R3 · Normal construction session via real Pi SDK 1.4.0 reads 3 materials and persists panorama, merged dual-route entry, and purpose draft into Enterprise Member Pack', { timeout: 90_000 }, async t => {
  const provider = await startToolProvider();
  t.after(() => provider.close());
  const host = await startTestHost();
  t.after(() => host.close());

  await json(await host.request('/api/configuration', 'PUT', {
    name: 'Member Pack Construction Synthetic',
    provider: 'openai-compatible',
    baseUrl: provider.baseUrl,
    model: 'synthetic-member-pack-build',
    apiKey: 'synthetic-only',
  }));

  // Register built-in Nike T03 reference for Route 2 linkage
  const t03Res = await json(await host.request('/api/studio/domain-references/repo-template', 'POST', {
    requestId: randomUUID(), templateId: 'T03',
  }));

  const ent = await json(await host.request('/api/studio/enterprises', 'POST', { requestId: randomUUID(), name: '织屿服饰' }), 201);
  const enterpriseId = ent.id;
  const buildResponse = await host.request('/api/projects', 'POST', { name: '会员资产建设' });
  const { project: projBuild } = await json(buildResponse, 201);
  const buildCookie = buildResponse.headers.get('set-cookie')!.split(';')[0]!;
  const buildReq = (route: string, method = 'GET', body?: unknown) =>
    fetch(host.baseUrl + route, { method, headers: { ...host.headers, cookie: buildCookie }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  await json(await host.request('/api/studio/enterprise-associations', 'POST', { requestId: randomUUID(), kind: 'project', entityId: projBuild.id, enterpriseId }));

  // Place 3 enterprise materials (制度、月报、字段表) into construction project's 020_clean/
  const policyText = '# 织屿会员制度\n单品牌会员账号口径，首购后30日内有效再购计复购，全额退款不计入有效购买。\n';
  const reportText = '# 2026年9月直营月报\n星桥直营店9月首购队列观察窗30天，跨店直营再购归首购门店。\n';
  const schemaText = 'field,desc\naccount,会员账号\norder_id,订单号\norder_date,下单日\nrefund_date,退款日\nfull_refund,是否全额退款\nstore,门店\n';
  fs.writeFileSync(path.join(projBuild.rootPath, '020_clean', 'member_policy.md'), policyText);
  fs.writeFileSync(path.join(projBuild.rootPath, '020_clean', 'monthly_report.md'), reportText);
  fs.writeFileSync(path.join(projBuild.rootPath, '020_clean', 'order_fields.csv'), schemaText);

  const { system } = await json(await buildReq('/api/studio/systems', 'POST', {
    requestId: randomUUID(), enterpriseId, name: '织屿会员体系', projectId: projBuild.id, goal: '梳理企业会员制度并形成会员运营资产包', topicTitle: '会员全景与复购',
  }), 201);

  const policyRef = {
    authority: 'data',
    id: sha('020_clean/member_policy.md'),
    version: sha(policyText),
    sha256: sha(policyText),
    projectId: projBuild.id,
    locator: '020_clean/member_policy.md',
    title: 'member_policy.md',
  };
  const reportRef = {
    authority: 'data',
    id: sha('020_clean/monthly_report.md'),
    version: sha(reportText),
    sha256: sha(reportText),
    projectId: projBuild.id,
    locator: '020_clean/monthly_report.md',
    title: 'monthly_report.md',
  };
  const schemaRef = {
    authority: 'data',
    id: sha('020_clean/order_fields.csv'),
    version: sha(schemaText),
    sha256: sha(schemaText),
    projectId: projBuild.id,
    locator: '020_clean/order_fields.csv',
    title: 'order_fields.csv',
  };

  let step = 0;
  let packReadResultText = '';
  provider.setResponder(context => {
    step += 1;
    if (step === 1) return { calls: [{ name: 'read_input', arguments: { filename: 'member_policy.md' } }] };
    if (step === 2) return { calls: [{ name: 'read_input', arguments: { filename: 'monthly_report.md' } }] };
    if (step === 3) return { calls: [{ name: 'read_input', arguments: { filename: 'order_fields.csv' } }] };
    if (step === 4) {
      return {
        calls: [{
          name: 'studio_assets',
          arguments: {
            action: 'pack-save-panorama',
            systemId: system.id,
            payload: {
              goal: '基于制度、9月月报与字段表盘点企业会员运营现状并建立复购与活跃用途',
              brand: '岚线',
              channel: '直营',
              period: '2026-09',
              dataCutoffAt: '2026-10-31',
              decisionPurpose: '支撑门店留存复购复盘与月度活跃诊断',
              sourceRefs: [policyRef, reportRef, schemaRef],
              recommendations: [
                {
                  purposeKey: 'store-first-purchase-30d-repurchase',
                  title: '门店首购后 30 日有效复购率',
                  priorityReason: '核心留存考核指标，具备制度与订单明细',
                  deliverableNow: '星桥直营店 9 月首购队列可试算',
                  minimumEvidence: '会员制度 + 订单明细 + 退款映射',
                  ownerRole: '会员运营负责人',
                  completionCriteria: '输出可复算分子分母',
                  selected: true,
                },
                {
                  purposeKey: 'monthly-purchase-active',
                  title: '自然月购买活跃率',
                  priorityReason: '区分购买活跃与活动签到',
                  deliverableNow: '口径定义先行',
                  minimumEvidence: '会员制度有效购买定义',
                  ownerRole: '会员运营负责人',
                  completionCriteria: '明确购买活跃排除签到',
                  selected: false,
                },
              ],
              issues: [
                {
                  id: 'iss-1',
                  problemName: '跨月全额退款原单关联缺失风险',
                  businessStatus: 'active',
                  assetSupportStatus: 'gap',
                  summary: '月报按当月退款口径统计，需核查跨月全额退款冲销规则',
                  factOrInference: 'fact',
                  decisionImpact: '高估 9 月首购队列有效复购率',
                  nextStep: '在共享销售退款映射中补齐跨月原单冲销',
                  evidence: [{ sourceRef: reportRef, locator: '020_clean/monthly_report.md', scope: '星桥直营店 2026-09' }],
                  candidatePurposeKey: 'store-first-purchase-30d-repurchase',
                },
              ],
            },
          },
        }],
      };
    }
    if (step === 5) {
      // Route 1: enterprise line entry
      return {
        calls: [{
          name: 'studio_assets',
          arguments: {
            action: 'pack-upsert-entry',
            systemId: system.id,
            payload: {
              entryKey: 'repurchase-valid-order',
              title: '有效再购与全额退款冲销规则',
              action: 'enterprise_new',
              routes: ['enterprise'],
              referenceLinks: [],
              enterpriseBasis: '织屿制度明确全额退款不计入有效购买',
              enterpriseSourceRefs: [policyRef],
              scope: '岚线直营门店 2026-09',
              impactedPurposeIds: [],
              exceptions: [],
            },
          },
        }],
      };
    }
    if (step === 6) {
      // Route 2: domain benchmark linkage into SAME entryKey -> MUST merge & preserve Route 1 sources!
      return {
        calls: [{
          name: 'studio_assets',
          arguments: {
            action: 'pack-upsert-entry',
            systemId: system.id,
            payload: {
              entryKey: 'repurchase-valid-order',
              title: '有效再购与全额退款冲销规则',
              action: 'modify',
              routes: ['domain'],
              referenceLinks: [{
                refId: t03Res.record.id,
                sourceId: t03Res.record.sourceId,
                version: t03Res.record.version,
                sectionLocator: '1-10',
                excerpt: 'Nike T03 行业参考有效购买口径',
              }],
              enterpriseBasis: '结合 T03 行业标杆补充复购退货边界说明',
              enterpriseSourceRefs: [],
              scope: '岚线直营门店 2026-09',
              impactedPurposeIds: [],
              exceptions: [],
            },
          },
        }],
      };
    }
    if (step === 7) {
      return {
        calls: [{
          name: 'studio_assets',
          arguments: {
            action: 'pack-upsert-purpose',
            systemId: system.id,
            payload: {
              purposeKey: 'store-first-purchase-30d-repurchase',
              title: '门店首购后 30 日有效复购率',
              businessQuestion: '哪些门店首购会员 30 日复购偏低？',
              subjectUnit: 'brand_account',
              windowDays: 30,
              scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店'], period: '2026-09', scopeKey: 'lanxian:direct:starbridge:2026-09' },
              tier: 'formal-calculation',
              businessStatus: 'active',
              originalGoal: '衡量星桥首购 30 日有效复购率',
              remainingGaps: [],
              exclusions: ['未成熟观察窗'],
              completionCriteria: '输出可复算分子分母',
              evidenceReadiness: { definition: 'pass', mapping: 'pass', sampleCalculation: 'pass' },
              policyEffectiveFrom: '2026-09-01',
              dataCutoffAt: '2026-10-31',
              observationWindowDays: 30,
              availableHistoryDays: 60,
            },
          },
        }],
      };
    }
    if (step === 8) {
      return { calls: [{ name: 'studio_assets', arguments: { action: 'pack-read', systemId: system.id } }] };
    }
    packReadResultText = providerMessageText(context.recentToolResults.at(-1)!.content);
    return { text: '已通读制度、月报与字段表，并将全景盘点、双路线条目与复购用途草案写入企业会员运营资产包。' };
  });

  // Send message on the normal Studio construction task!
  await json(await host.request(`/api/projects/${projBuild.id}/tasks/${system.taskId}/messages`, 'POST', {
    requestId: randomUUID(),
    text: '请阅读制度、月报和字段表，将盘点全景、双路线规则与门店复购用途写入企业会员包。',
    studioContext: { systemId: system.id, purpose: 'construction' },
  }), 202);
  await waitIdle(host, projBuild.id, system.taskId);
  assert.deepEqual(provider.errors, []);

  // Verify persistence directly in Host API!
  const listed = await json(await buildReq(`/api/studio/enterprise-packs?enterpriseId=${enterpriseId}&domain=member-operations`));
  assert.equal(listed.packs.length, 1);
  const pack = listed.packs[0];
  assert.equal(pack.panorama.version, 1);
  assert.equal(pack.panorama.recommendations.length, 2);
  assert.equal(pack.panorama.issues.length, 1);
  assert.equal(pack.entries.length, 1);
  // Dual-route merge preserved BOTH routes & BOTH source references!
  assert.deepEqual(pack.entries[0].routes.slice().sort(), ['domain', 'enterprise']);
  assert.equal(pack.entries[0].enterpriseSourceRefs.length, 1);
  assert.equal(pack.entries[0].referenceLinks.length, 1);
  assert.equal(pack.purposes.length, 1);
  assert.equal(pack.purposes[0].purposeKey, 'store-first-purchase-30d-repurchase');
  assert.match(packReadResultText, /store-first-purchase-30d-repurchase/);
});

test('R1/R2/R4/R5 · Real Pi SDK 1.4.0 enforces default-deny, live Pi native read/bash narrowing, directory-only feedback separation & taskCutoff preservation, exact version read + report verification, authority revision v1.0->v1.1, and independent Python recalculation (C07 changes, C13 stays)', { timeout: 180_000 }, async t => {
  const provider = await startToolProvider();
  t.after(() => provider.close());
  let host = await startTestHost();
  t.after(() => host.close());

  await json(await host.request('/api/configuration', 'PUT', {
    name: 'Member Pack Pi Synthetic',
    provider: 'openai-compatible',
    baseUrl: provider.baseUrl,
    model: 'synthetic-member-pack-pi',
    apiKey: 'synthetic-only',
  }));

  const ent = await json(await host.request('/api/studio/enterprises', 'POST', { requestId: randomUUID(), name: '织屿服饰' }), 201);
  const enterpriseId = ent.id;

  const ownerRegResp = await host.request('/api/studio/operators/session', 'POST', {
    action: 'register',
    operatorId: 'ops-runtime-owner',
    displayName: '运行时会员包负责人',
    passcode: 'runtime-owner-2026',
  });
  let ownerCookie = (ownerRegResp.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  assert.ok(ownerCookie.startsWith('optracall_op_ctx='), 'Operator session registration MUST issue Host-signed optracall_op_ctx cookie!');
  await json(ownerRegResp, 200);

  const projBuildResp = await fetch(host.baseUrl + '/api/projects', {
    method: 'POST',
    headers: { ...host.headers, cookie: ownerCookie },
    body: JSON.stringify({ name: '会员建设' }),
  });
  ownerCookie = (projBuildResp.headers.get('set-cookie') ?? '').split(';')[0] || ownerCookie;
  assert.ok(ownerCookie.startsWith('optracall_op_ctx='), 'POST /api/projects MUST issue Host-signed optracall_op_ctx cookie!');
  const { project: projBuild } = await json(projBuildResp, 201);
  const ownerReq = (route: string, method = 'GET', body?: unknown) =>
    fetch(host.baseUrl + route, {
      method,
      headers: { ...host.headers, cookie: ownerCookie },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const projectReq = async (projectId: string, route: string, method = 'GET', body?: unknown) => {
    const selected = await ownerReq(`/api/projects/${projectId}`);
    assert.equal(selected.status, 200);
    const cookie = selected.headers.get('set-cookie')!.split(';')[0]!;
    return fetch(host.baseUrl + route, { method, headers: { ...host.headers, cookie }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  };
  const seedCaseDecisionAndRestart = async (args: {
    caseId: string;
    recordId?: string;
    expectedRevision: number;
    title: string;
    proposal: string;
    projectId: string;
    taskId: string;
    references?: CaseDecisionReference[];
  }) => {
    const savedDataRoot = host.dataRoot;
    const savedProjectsRoot = host.projectsRoot;
    await host.close();
    const store = new CaseStore({ dataRoot: savedDataRoot });
    await store.init();
    const status = store.getStatus();
    assert.equal(status.state, 'ready');
    const saved = store.saveDecisionDraft(
      {
        operationId: randomUUID(),
        caseStoreId: status.storeId!,
        caseId: args.caseId,
        ...(args.recordId ? { recordId: args.recordId } : {}),
        expectedRevision: args.expectedRevision,
        kind: 'strategy',
        payload: { title: args.title, proposal: args.proposal },
        ...(args.references ? { references: args.references } : {}),
      },
      { actorKind: 'agent', projectId: args.projectId, taskId: args.taskId, requestId: randomUUID(), sessionId: 'runtime-seed-session', toolCallId: `seed-${randomUUID()}` },
    );
    store.close();
    host = await startTestHost({ dataRoot: savedDataRoot, projectsRoot: savedProjectsRoot });
    const loginResp = await host.request('/api/studio/operators/session', 'POST', {
      action: 'login',
      operatorId: 'ops-runtime-owner',
      passcode: 'runtime-owner-2026',
      activeProjectId: projBuild.id,
    });
    ownerCookie = (loginResp.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    await json(loginResp, 200);
    return saved;
  };

  const { project: projUngranted } = await json(await host.request('/api/projects', 'POST', { name: '未授权分析' }), 201);
  const { project: projMerch } = await json(await host.request('/api/projects', 'POST', { name: '商品部口径' }), 201);
  const { project: projStar } = await json(await host.request('/api/projects', 'POST', { name: '星桥门店分析' }), 201);
  const { project: projAud } = await json(await host.request('/api/projects', 'POST', { name: '两店独立复算' }), 201);

  for (const p of [projBuild, projUngranted, projMerch, projStar, projAud]) {
    await json(await host.request('/api/studio/enterprise-associations', 'POST', { requestId: randomUUID(), kind: 'project', entityId: p.id, enterpriseId }));
  }

  // Synthetic 4-account Starbridge order dataset:
  // C07: 9月首购 + 9月再购 O-73（10月2日全额退款 -> v1.0同月规则计入=3/4, v1.1跨月原单规则排除=2/4 -> 应变！）
  // C13: 9月首购 + 9月有效再购 O-81（未退款 -> v1.0与v1.1均有效 -> 应保留！）
  // C21: 9月首购 + 9月有效再购 O-88（未退款）
  // C30: 9月首购无再购
  const starCsv = [
    'account,first_order_date,repeat_order_id,repeat_order_date,refund_date,full_refund,store,data_available_at,brand,channel',
    'C07,2026-09-02,O-73,2026-09-18,2026-10-02,true,星桥直营店,2026-10-03,岚线,直营',
    'C13,2026-09-03,O-81,2026-09-20,,false,星桥直营店,2026-09-20,岚线,直营',
    'C21,2026-09-05,O-88,2026-09-24,,false,星桥直营店,2026-09-24,岚线,直营',
    'C30,2026-09-06,,,,false,星桥直营店,2026-09-06,岚线,直营',
    '',
  ].join('\n');
  const willowCsv = 'account,first_order_date,repeat_order_id,repeat_order_date,refund_date,full_refund,store,brand,channel\nW01,2026-09-04,O-99,2026-09-19,,false,柳岸直营店,岚线,直营\n';
  for (const p of [projMerch, projStar, projAud]) {
    fs.writeFileSync(path.join(p.rootPath, '020_clean', 'starbridge_orders.csv'), starCsv);
    fs.writeFileSync(path.join(p.rootPath, '020_clean', 'willowbank_orders.csv'), willowCsv);
  }

  fs.writeFileSync(path.join(projAud.rootPath, '020_clean', 'store-opening-policy.csv'), 'store,opens,brand,channel\n星桥直营店,10:00,岚线,直营\n');

  // Seed REAL original authorities for v1.0:
  // 1) Real SAP Method v1 (同月退款口径)
  const methodV1 = await json(await host.request('/api/sap/methods', 'POST', {
    requestId: randomUUID(),
    title: '销售退款映射规则（同月口径）',
    content: {
      conditions: '岚线直营门店 2026-09 销售与退款流水',
      logic: 'v1口径：仅扣除与再购单同月的全额退款，未跨月关联10月退款单',
      judgment: '净有效再购 > 0 计为复购',
      limits: '暂未关联跨月退款原单',
    },
    sources: [],
  }), 201);
  await json(await host.request(`/api/sap/methods/${methodV1.method.id}/publish`, 'POST', {
    requestId: randomUUID(), version: 1, expectedSha256: methodV1.version.contentSha256,
  }));
  await json(await host.request('/api/studio/enterprise-associations', 'POST', {
    requestId: randomUUID(), kind: 'asset', authority: 'sap-method', entityId: methodV1.method.id, enterpriseId,
  }));
  const refundV1Ref = {
    authority: 'sap-method' as const,
    id: methodV1.method.id,
    version: '1',
    sha256: methodV1.version.contentSha256,
    title: '销售退款映射规则 v1',
  };

  // 2) Real SAP 0.2 Metric v1.0.0
  const baseSapYaml = fs.readFileSync(
    path.join(process.cwd(), 'extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml'),
    'utf8',
  ).replaceAll('reviewed_by: huangbo', 'reviewed_by: synthetic-reviewer');
  fs.writeFileSync(path.join(projBuild.rootPath, '020_clean', 'repurchase-v1.sap.yaml'), baseSapYaml);
  const valV1 = await json(await host.request('/api/metric-factory/draft/validate', 'POST', {
    projectId: projBuild.id, path: '020_clean/repurchase-v1.sap.yaml',
  }));
  const sapPubV1 = await json(await host.request('/api/metric-factory/publish', 'POST', {
    projectId: projBuild.id, path: '020_clean/repurchase-v1.sap.yaml', publishedBy: 'synthetic-reviewer', expectedPackageFingerprint: valV1.packageFingerprint,
  }), 201);
  const sapM1Ref = {
    authority: 'sap-metric' as const,
    id: sapPubV1.entry.id,
    version: '1.0.0',
    sha256: sapPubV1.entry.bytesSha256,
    title: '复购指标 1.0.0',
  };

  // Create Studio system + Enterprise Member Pack v1.0 backed by REAL authorities (NO forged moduleReceipts!)
  const { system } = await json(await ownerReq('/api/studio/systems', 'POST', {
    requestId: randomUUID(), enterpriseId, name: '织屿会员体系', projectId: projBuild.id, goal: '会员运营资产包', topicTitle: '门店复购',
  }), 201);
  const { pack } = await json(await ownerReq('/api/studio/enterprise-packs', 'POST', {
    requestId: randomUUID(), enterpriseId, systemId: system.id, domain: 'member-operations', name: '织屿会员运营包',
  }));
  const packId = pack.id;

  const { purpose } = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}/purposes`, 'POST', {
    requestId: randomUUID(), projectId: projBuild.id,
    purposeKey: 'store-first-purchase-30d-repurchase', title: '门店首购后 30 日有效复购率',
    businessQuestion: '9 月星桥首购队列 30 日复购率', subjectUnit: 'brand_account', windowDays: 30,
    scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店'], period: '2026-09', scopeKey: 'lanxian:direct:starbridge:2026-09' },
    tier: 'formal-calculation', businessStatus: 'active', originalGoal: '核算 9 月星桥复购',
    exclusions: ['未成熟观察窗'], completionCriteria: '核清分子分母',
    evidenceReadiness: { definition: 'pass', mapping: 'pass', sampleCalculation: 'pass' },
    dependencies: [
      { id: 'dep-refund', role: 'shared-asset', authority: 'sap-method', ref: refundV1Ref, requiredFor: ['formal-calculation'] },
      { id: 'dep-sap', role: 'sap-metric', authority: 'sap-metric', ref: sapM1Ref, requiredFor: ['formal-calculation'] },
    ],
    policyEffectiveFrom: '2026-09-01', dataCutoffAt: '2026-10-31', observationWindowDays: 30, availableHistoryDays: 60,
  }));

  const { preview: prev1 } = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}/previews`, 'POST', {
    requestId: randomUUID(), projectId: projBuild.id, version: '1.0', purposeIds: [purpose.id],
    policyEffectiveFrom: '2026-09-01', dataCutoffAt: '2026-10-31', summary: '首版发布 v1.0',
  }));
  const conf1 = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}/confirm`, 'POST', {
    requestId: randomUUID(), projectId: projBuild.id, previewId: prev1.id, fingerprint: prev1.fingerprint, confirmedBy: '会员运营负责人',
  }));
  assert.equal(conf1.revision.purposeManifests[0].status, 'eligible');

  // --- 2A. Default-deny on ungranted same-enterprise project ---
  const { task: taskU } = await json(await host.request(`/api/projects/${projUngranted.id}/tasks`, 'POST', { name: '未授权项目探测' }), 201);
  let stepU = 0;
  let catalogU = '';
  provider.setResponder(context => {
    stepU += 1;
    if (stepU === 1) return { calls: [{ name: 'studio_assets', arguments: { action: 'catalog' } }] };
    catalogU = providerMessageText(context.recentToolResults.at(-1)!.content);
    return { text: '未获授权，未看到可用会员包用途。' };
  });
  await json(await host.request(`/api/projects/${projUngranted.id}/tasks/${taskU.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '查看目录中可用的会员包用途。',
  }), 202);
  await waitIdle(host, projUngranted.id, taskU.id);
  assert.match(catalogU, /"authorizationRequired":true/);
  assert.match(catalogU, /"purposes":\[\]/);

  // Seed an UNRELATED enabled enterprise material (NOT in pack dependencies) to test R5.1 unrelated-read counterexample!
  const unrelatedMat = await json(await host.request('/api/enterprise-materials', 'POST', {
    title: '无关行政公告 v1',
    body: '本文件为行政办公作息通知，与会员运营资产包无任何依赖关系。',
  }), 201);
  const unrelatedEnabled = await json(await host.request(`/api/enterprise-materials/${unrelatedMat.material.id}/enable`, 'POST', {
    expectedVersion: unrelatedMat.material.version,
  }));
  await json(await host.request('/api/studio/enterprise-associations', 'POST', {
    requestId: randomUUID(), kind: 'asset', authority: 'enterprise', entityId: unrelatedMat.material.id, enterpriseId,
  }));
  const unrelatedMatRef = {
    authority: 'enterprise' as const,
    id: unrelatedMat.material.id,
    version: unrelatedEnabled.material.revisions[0].revisionId,
    sha256: unrelatedEnabled.material.revisions[0].bodySha256,
    locator: unrelatedEnabled.storeId,
    title: '无关行政公告 v1',
  };

  // R2 (Round-7): Bare cookie-less HTTP request MUST get 403 even for owner project!
  assert.equal((await host.request(`/api/studio/resource-grants/authority?enterpriseId=${enterpriseId}&projectId=${projBuild.id}`)).status, 403, 'Bare cookie-less request MUST get 403!');
  assert.equal((await ownerReq(`/api/studio/resource-grants/authority?enterpriseId=${enterpriseId}&projectId=${projStar.id}`)).status, 403);
  const buildAuth = (await json(await ownerReq(`/api/studio/resource-grants/authority?enterpriseId=${enterpriseId}&projectId=${projBuild.id}`))).grantAuthority;
  assert.match(buildAuth.authorityToken, /^[a-f0-9]{64}$/);
  const hasOsSandbox = process.platform === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec');

  // --- 2B. Directory-only task (projMerch, read-definition only) with task cutoff 2026-10-27 vs pack 2026-10-31 ---
  await json(await ownerReq('/api/studio/resource-grants', 'POST', {
    requestId: randomUUID(), enterpriseId, grantorProjectId: projBuild.id, authorityToken: buildAuth.authorityToken, grantBasis: '商品部仅查定义，禁读明细',
    subjectType: 'project', subjectId: projMerch.id, resourceKind: 'definition',
    purposeKeys: ['store-first-purchase-30d-repurchase'], operations: ['read-definition'],
    scope: { brand: '岚线', channel: '直营' },
  }));

  const { task: taskD } = await json(await host.request(`/api/projects/${projMerch.id}/tasks`, 'POST', { name: '商品部仅看目录反例' }), 201);
  let stepD = 0;
  let merchDetailBlocked = false;
  provider.setResponder(context => {
    stepD += 1;
    if (stepD === 1) return { calls: [{ name: 'studio_assets', arguments: { action: 'catalog' } }] };
    if (stepD === 2) {
      return hasOsSandbox
        ? { calls: [{ name: 'read', arguments: { path: 'starbridge_orders.csv' } }] }
        : { calls: [{ name: 'read_input', arguments: { filename: 'starbridge_orders.csv' } }] };
    }
    const readResText = providerMessageText(context.recentToolResults.at(-1)!.content);
    merchDetailBlocked = readResText.includes('detail_access_not_authorized') || readResText.includes('禁止读取项目 020_clean') || readResText.includes('resource_detail_not_authorized') || readResText.includes('no_active_grant_for_read_detail_recalculate') || readResText.includes('not_authorized');
    return { text: '仅查看了目录，未读取任何原资产，且无权读取明细文件。' };
  });
  await json(await host.request(`/api/projects/${projMerch.id}/tasks/${taskD.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '请按数据截止 2026-10-27 查阅门店复购目录。',
  }), 202);
  const stateD = await waitIdle(host, projMerch.id, taskD.id);
  assert.equal(merchDetailBlocked, true, 'Definition-only project MUST be blocked from reading 020_clean CSV!');
  if (!hasOsSandbox) {
    for (const rawTool of ['bash', 'read', 'write', 'edit', 'ls', 'grep', 'find', 'codemode', 'subagent']) {
      assert.equal((stateD.snapshot.tools ?? []).includes(rawTool), false, `Without OS sandbox, restricted session MUST withhold raw tool ${rawTool}!`);
    }
  }

  const assistantMsgD = [...stateD.snapshot.messages].reverse().find((m: any) => m.role === 'assistant' && m.nativeEntryId && m.nativeSessionId);
  assert.ok(assistantMsgD);
  const fbDirOnly = await json(await projectReq(projMerch.id, `/api/studio/enterprise-packs/${packId}/feedback`, 'POST', {
    requestId: randomUUID(),
    origin: { projectId: projMerch.id, taskId: taskD.id, sessionId: assistantMsgD.nativeSessionId, messageId: assistantMsgD.nativeEntryId },
    problemKey: 'directory-only-clue',
    title: '目录线索反馈（未读原资产）',
    category: 'member_policy',
    evidenceNote: '商品部仅看了目录，反馈线索待核实',
  }));
  const dirReport = fbDirOnly.feedback.reports[0];
  assert.equal(dirReport.adoptionBasis, 'directory_only_unverified', 'Directory-only task MUST NOT be marked verified_actual_read!');
  assert.equal(dirReport.usedPackVersion, undefined, 'Directory-only task MUST NOT claim usedPackVersion="1.0"!');
  assert.equal(dirReport.observedDirectoryVersion, '1.0');
  assert.equal(dirReport.taskCutoffAt, '2026-10-27', 'Task cutoff 2026-10-27 MUST NOT be overwritten by pack cutoff 2026-10-31!');
  assert.equal(dirReport.packDataCutoffAt, '2026-10-31');

  // R5.1 COUNTEREXAMPLE: Turn reading ONLY an UNRELATED enterprise material MUST NOT become verified_actual_read!
  let stepD2 = 0;
  provider.setResponder(() => {
    stepD2 += 1;
    if (stepD2 === 1) return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', payload: { ref: unrelatedMatRef } } }] };
    return { text: '仅读取了无关行政公告，未读取任何会员包原依赖。' };
  });
  await json(await host.request(`/api/projects/${projMerch.id}/tasks/${taskD.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '查阅行政办公作息通知。',
  }), 202);
  const stateD2 = await waitIdle(host, projMerch.id, taskD.id, stateD.snapshot.messages.length + 2);
  const assistantMsgD2 = [...stateD2.snapshot.messages].reverse().find((m: any) => m.role === 'assistant' && m.nativeEntryId && m.nativeSessionId);
  assert.ok(assistantMsgD2);
  const fbUnrelated = await json(await projectReq(projMerch.id, `/api/studio/enterprise-packs/${packId}/feedback`, 'POST', {
    requestId: randomUUID(),
    origin: { projectId: projMerch.id, taskId: taskD.id, sessionId: assistantMsgD2.nativeSessionId, messageId: assistantMsgD2.nativeEntryId },
    problemKey: 'unrelated-read-counterexample',
    title: '读取无关材料反例反馈',
    category: 'member_policy',
    evidenceNote: '本轮仅读了无关行政公告',
  }));
  assert.notEqual(fbUnrelated.feedback.reports[0].adoptionBasis, 'verified_actual_read', 'Reading an unrelated material MUST NOT be marked verified_actual_read!');
  assert.equal(fbUnrelated.feedback.reports[0].usedPackVersion, undefined);

  // --- 2C. Authorized Starbridge task: OS sandbox (macOS) OR strict Host-mediated tools (Linux) + auto-use on declare-use + same-task self-assessment stays pending + independent verifier passes + same-task same-name report immutability ---
  const starGrantCreated = await json(await ownerReq('/api/studio/resource-grants', 'POST', {
    requestId: randomUUID(), enterpriseId, grantorProjectId: projBuild.id, authorityToken: buildAuth.authorityToken, grantBasis: '星桥店长仅读本店明细',
    subjectType: 'project', subjectId: projStar.id, resourceKind: 'detail',
    purposeKeys: ['store-first-purchase-30d-repurchase'], operations: ['read-definition', 'read-detail-recalculate'],
    scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店'], allowedDataPaths: ['020_clean/starbridge_orders.csv'] },
  }));
  const starGrantId = starGrantCreated.grant.id;

  const { task: taskA } = await json(await host.request(`/api/projects/${projStar.id}/tasks`, 'POST', { name: '星桥首版复购分析' }), 201);
  let stepA = 0;
  let starAllowed = false;
  let starReadText = '';
  let willowInputBlocked = false;
  let willowNativeReadBlocked = false;
  let willowNativeBashBlocked = false;
  let physicalIsolationProof = '';
  let taskACatalogText = '';
  let refundV1ReadText = '';
  let sapM1ReadText = '';
  let taskAStudioUseId = '';

  const transaction = (itemId: string, originalOrderId: string, disposition: string) => ({
    itemId, originalOrderId, disposition,
  });
  const reportV1BodyText = JSON.stringify({
    packVersion: '1.0', numerator: 3, denominator: 4, accounts: ['C07', 'C13', 'C21'],
    transactions: [
      transaction('C07', 'O-73', '计入复购'),
      transaction('C13', 'O-81', '计入复购'),
      transaction('C21', 'O-88', '计入复购'),
    ],
  });
  const assessV1SelfBodyText = JSON.stringify({ assessed: 'repurchase-v1.0.json', status: 'pass', selfAssessed: true, numerator: 3, denominator: 4 });

  provider.setResponder(context => {
    stepA += 1;
    if (stepA === 1) return { calls: [{ name: 'studio_assets', arguments: { action: 'catalog' } }] };
    if (stepA === 2) {
      taskACatalogText = providerMessageText(context.recentToolResults.at(-1)!.content);
      return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', payload: { ref: refundV1Ref } } }] };
    }
    if (stepA === 3) {
      refundV1ReadText = providerMessageText(context.recentToolResults.at(-1)!.content);
      return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', payload: { ref: sapM1Ref } } }] };
    }
    if (stepA === 4) {
      sapM1ReadText = providerMessageText(context.recentToolResults.at(-1)!.content);
      return { calls: [{ name: 'read_input', arguments: { filename: 'starbridge_orders.csv', purposeId: purpose.id } }] };
    }
    if (stepA === 5) {
      starReadText = providerMessageText(context.recentToolResults.at(-1)!.content);
      starAllowed = starReadText.includes('C07') && starReadText.includes('C13');
      return { calls: [{ name: 'read_input', arguments: { filename: 'willowbank_orders.csv' } }] };
    }
    if (hasOsSandbox) {
      if (stepA === 6) {
        const txt = providerMessageText(context.recentToolResults.at(-1)!.content);
        willowInputBlocked = txt.includes('detail_data_path_not_authorized') || txt.includes('resource_detail_not_authorized');
        return { calls: [{ name: 'read', arguments: { path: 'willowbank_orders.csv' } }] };
      }
      if (stepA === 7) {
        const txt = providerMessageText(context.recentToolResults.at(-1)!.content);
        willowNativeReadBlocked = txt.includes('store_detail_not_authorized') || txt.includes('ENOENT') || txt.includes('not_authorized') || txt.includes('No such file');
        return { calls: [{ name: 'bash', arguments: { command: 'cat willowbank_orders.csv' } }] };
      }
      if (stepA === 8) {
        const txt = providerMessageText(context.recentToolResults.at(-1)!.content);
        willowNativeBashBlocked = txt.includes('store_detail_not_authorized') || txt.includes('No such file') || txt.includes('not_authorized') || txt.includes('Operation not permitted');
        const pyCmd = `python3 -c "import csv, hashlib, json, os; print('ISO_CWD=' + os.getcwd() + '|STAR=' + str(os.path.exists('starbridge_orders.csv'))); rows = list(csv.DictReader(open('starbridge_orders.csv'))); rep = [r['account'] for r in rows if r['repeat_order_id'] and not (r['full_refund']=='true' and r['refund_date'].startswith('2026-09'))]; body = json.dumps({'packVersion':'1.0','numerator':len(rep),'denominator':len(rows),'accounts':rep,'transactions':[{'itemId':r['account'],'originalOrderId':r['repeat_order_id'],'disposition':'计入复购' if r['account'] in rep else '冲销排除'} for r in rows if r['repeat_order_id']]}, ensure_ascii=False).encode(); open('../060_reports/repurchase-v1.0.json','wb').write(body); print('REP_SHA=' + hashlib.sha256(body).hexdigest()); abody = json.dumps({'assessed':'repurchase-v1.0.json','status':'pass','selfAssessed':True,'numerator':len(rep),'denominator':len(rows)}, ensure_ascii=False).encode(); open('../060_reports/repurchase-v1.0-self-assess.json','wb').write(abody); print('ASSESS_SHA=' + hashlib.sha256(abody).hexdigest())"`;
        return { calls: [{ name: 'bash', arguments: { command: pyCmd } }] };
      }
      if (stepA === 9) {
        physicalIsolationProof = providerMessageText(context.recentToolResults.at(-1)!.content);
        const repSha = /REP_SHA=([a-f0-9]{64})/.exec(physicalIsolationProof)?.[1];
        assert.ok(repSha, physicalIsolationProof);
        return {
          calls: [{
            name: 'studio_assets',
            arguments: {
              action: 'declare-use',
              systemId: system.id,
              payload: {
                report: { authority: 'task', id: taskA.id, projectId: projStar.id, taskId: taskA.id, version: repSha, sha256: repSha, locator: '060_reports/repurchase-v1.0.json' },
                sources: [refundV1Ref, sapM1Ref],
                result: 'Task A 原生 declare-use：按 v1.0 核得星桥 3/4',
              },
            },
          }],
        };
      }
      if (stepA === 10) {
        const declResult = JSON.parse(providerMessageText(context.recentToolResults.at(-1)!.content));
        taskAStudioUseId = declResult?.use?.id;
        assert.ok(taskAStudioUseId);
        const assessSha = /ASSESS_SHA=([a-f0-9]{64})/.exec(physicalIsolationProof)?.[1];
        assert.ok(assessSha, physicalIsolationProof);
        return {
          calls: [{
            name: 'studio_assets',
            arguments: {
              action: 'assess-use',
              systemId: system.id,
              payload: {
                useId: taskAStudioUseId,
                status: 'pass',
                report: { authority: 'task', id: taskA.id, projectId: projStar.id, taskId: taskA.id, version: assessSha, sha256: assessSha, locator: '060_reports/repurchase-v1.0-self-assess.json' },
                sources: [refundV1Ref, sapM1Ref],
                result: 'Task A 同任务自评报告（不应视为独立核验通过）',
              },
            },
          }],
        };
      }
    } else {
      if (stepA === 6) {
        const txt = providerMessageText(context.recentToolResults.at(-1)!.content);
        willowInputBlocked = txt.includes('detail_data_path_not_authorized') || txt.includes('resource_detail_not_authorized');
        return { calls: [{ name: 'write_report', arguments: { filename: 'repurchase-v1.0.json', content: reportV1BodyText } }] };
      }
      if (stepA === 7) {
        return { calls: [{ name: 'write_report', arguments: { filename: 'repurchase-v1.0-self-assess.json', content: assessV1SelfBodyText } }] };
      }
      if (stepA === 8) {
        const repSha = sha(reportV1BodyText);
        return {
          calls: [{
            name: 'studio_assets',
            arguments: {
              action: 'declare-use',
              systemId: system.id,
              payload: {
                report: { authority: 'task', id: taskA.id, projectId: projStar.id, taskId: taskA.id, version: repSha, sha256: repSha, locator: '060_reports/repurchase-v1.0.json' },
                sources: [refundV1Ref, sapM1Ref],
                result: 'Task A 原生 declare-use：按 v1.0 核得星桥 3/4',
              },
            },
          }],
        };
      }
      if (stepA === 9) {
        const declResult = JSON.parse(providerMessageText(context.recentToolResults.at(-1)!.content));
        taskAStudioUseId = declResult?.use?.id;
        assert.ok(taskAStudioUseId);
        const assessSha = sha(assessV1SelfBodyText);
        return {
          calls: [{
            name: 'studio_assets',
            arguments: {
              action: 'assess-use',
              systemId: system.id,
              payload: {
                useId: taskAStudioUseId,
                status: 'pass',
                report: { authority: 'task', id: taskA.id, projectId: projStar.id, taskId: taskA.id, version: assessSha, sha256: assessSha, locator: '060_reports/repurchase-v1.0-self-assess.json' },
                sources: [refundV1Ref, sapM1Ref],
                result: 'Task A 同任务自评报告（不应视为独立核验通过）',
              },
            },
          }],
        };
      }
    }
    return { text: '星桥9月首购队列按v1.0（已查读销售退款映射v1及复购指标1.0.0并完成原生 declare-use）核得 3/4（C07、C13、C21），结果已保存至 060_reports/repurchase-v1.0.json；柳岸明细未授权，未当作零。' };
  });

  await json(await host.request(`/api/projects/${projStar.id}/tasks/${taskA.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '请按星桥直营店授权资料核查 9 月门店复购（数据截止 2026-10-31）。',
  }), 202);
  const stateA = await waitIdle(host, projStar.id, taskA.id);
  assert.equal(starAllowed, true, starReadText);
  assert.equal(willowInputBlocked, true);
  const sandboxCleanDir = path.join(host.dataRoot, 'member-pack-workspaces', projStar.id, taskA.id, '020_clean');
  if (hasOsSandbox) {
    assert.equal(willowNativeReadBlocked, true, 'Pi native read on unauthorized willowbank_orders.csv MUST be blocked!');
    assert.equal(willowNativeBashBlocked, true, 'Pi native bash referencing unauthorized willowbank_orders.csv MUST be blocked!');
    assert.match(physicalIsolationProof, /member-pack-workspaces/, 'Restricted task MUST run inside task-isolated workspace sandbox!');
    assert.match(physicalIsolationProof, /STAR=True/, 'Authorized file MUST exist in restricted task sandbox!');
    assert.equal(fs.existsSync(path.join(sandboxCleanDir, 'starbridge_orders.csv')), true);
  } else {
    // R2: When OS Seatbelt sandbox is unavailable, raw detail CSV MUST NOT be copied into unprotected sandbox dir AND raw tools MUST be withheld!
    assert.equal(fs.existsSync(path.join(sandboxCleanDir, 'starbridge_orders.csv')), false, 'Without OS sandbox, raw detail CSV MUST NOT be copied into unprotected cleanDir!');
    assert.equal((stateA.snapshot.tools ?? []).includes('bash'), false, 'Without OS sandbox, raw bash MUST be withheld!');
    assert.equal((stateA.snapshot.tools ?? []).includes('read'), false, 'Without OS sandbox, raw read MUST be withheld!');
  }
  assert.equal(fs.existsSync(path.join(sandboxCleanDir, 'willowbank_orders.csv')), false, 'Unauthorized willowbank_orders.csv MUST NOT physically exist in restricted task sandbox!');
  assert.equal((stateA.snapshot.tools ?? []).includes('subagent'), false, 'Restricted member-pack session MUST disable subagent delegation!');
  assert.equal((stateA.snapshot.tools ?? []).some((t: string) => t.startsWith('db_') || t.includes('dblink')), false, 'Restricted member-pack session MUST withhold dbLink tools!');
  assert.match(taskACatalogText, /"pinnedVersion":"1\.0"/);
  assert.match(taskACatalogText, /"dependencies":\[/);
  assert.match(refundV1ReadText, /v1口径：仅扣除与再购单同月的全额退款/);
  assert.match(sapM1ReadText, /membership-repurchase/);
  assert.deepEqual(provider.errors, []);

  // Verify 060_reports/repurchase-v1.0.json exists & matches!
  const reportV1Path = path.join(projStar.rootPath, '060_reports', 'repurchase-v1.0.json');
  const reportV1Bytes = fs.readFileSync(reportV1Path);
  const reportV1Json = JSON.parse(reportV1Bytes.toString('utf8'));
  assert.equal(reportV1Json.numerator, 3);
  assert.equal(reportV1Json.denominator, 4);
  assert.ok(reportV1Json.accounts.includes('C07'));
  assert.ok(reportV1Json.accounts.includes('C13'));

  // R4 (Round-5): Normal analysis declare-use MUST ALREADY have auto-recorded Task A's useRecord in Enterprise Pack!
  // AND Task A's same-task self-assessment MUST keep independentVerification at 'pending' (selfAssessmentOnly: true, NEVER 'pass')!
  const packAfterTaskA = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}`));
  const autoUseA = packAfterTaskA.pack.useRecords.find((u: any) => u.taskId === taskA.id && u.purposeId === purpose.id);
  assert.ok(autoUseA, 'Normal studio_assets declare-use MUST automatically create an Enterprise Pack useRecord!');
  assert.equal(autoUseA.actualReads.length, 2, 'Auto-recorded useRecord MUST capture BOTH native read-source receipts from Task A Turn 1!');
  assert.ok(autoUseA.authorDeclaration, 'Auto-recorded useRecord MUST bind authorDeclaration from declare-use!');
  assert.equal(autoUseA.independentVerification.status, 'pending', 'Same-task author self-assessment MUST NOT achieve independentVerification=pass!');
  assert.equal(autoUseA.independentVerification.selfAssessmentOnly, true, 'Same-task self-assessment MUST be explicitly flagged selfAssessmentOnly=true!');

  const { task: definitionReportReader } = await json(await host.request(`/api/projects/${projMerch.id}/tasks`, 'POST', { name: '仅定义授权的历史报告检查' }), 201);
  let definitionReadResult = '';
  provider.setResponder(context => {
    if (!context.recentToolResults.length) return { calls: [{
      name: 'studio_assets', arguments: { action: 'read-source', systemId: system.id, payload: { ref: autoUseA.reportRef } },
    }] };
    definitionReadResult = providerMessageText(context.recentToolResults.at(-1)!.content);
    return { text: '已检查当前可见范围。' };
  });
  await json(await host.request(`/api/projects/${projMerch.id}/tasks/${definitionReportReader.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '确认这个历史报告当前是否获准查看。',
  }), 202);
  await waitIdle(host, projMerch.id, definitionReportReader.id);
  assert.match(definitionReadResult, /studio_report_permission_denied/);
  assert.ok(!definitionReadResult.includes('C07'));

  // Even POST /uses/:id/verify with independentConfirmed: true MUST still reject same-task self-assessment as pass!
  const verifySelfOnly = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}/uses/${autoUseA.id}/verify`, 'POST', {
    requestId: randomUUID(),
    verifierRole: '试图用同任务自评通过',
    expectedRef: refundV1Ref,
    independentConfirmed: true,
    verdictDetail: '同任务自评不得视作独立核验',
  }));
  assert.equal(verifySelfOnly.use.independentVerification.status, 'pending', 'POST /verify MUST keep same-task self-assessment pending!');
  assert.equal(verifySelfOnly.use.independentVerification.selfAssessmentOnly, true);

  // R4 (Round-6/7): Grant projAud and FIRST run a BLIND independent verifier (submits assessment JSON WITHOUT reading required assets -> MUST stay pending!)
  await json(await ownerReq('/api/studio/resource-grants', 'POST', {
    requestId: randomUUID(), enterpriseId, grantorProjectId: projBuild.id, authorityToken: buildAuth.authorityToken, grantBasis: '独立核算岗全店复算',
    subjectType: 'project', subjectId: projAud.id, resourceKind: 'detail',
    purposeKeys: ['store-first-purchase-30d-repurchase'], operations: ['read-definition', 'read-detail-recalculate'],
    scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店', '柳岸直营店'], allowedDataPaths: ['020_clean/starbridge_orders.csv', '020_clean/willowbank_orders.csv', '020_clean/store-opening-policy.csv'] },
  }));
  const { task: taskBlindVerify } = await json(await host.request(`/api/projects/${projAud.id}/tasks`, 'POST', { name: '盲签核验反例任务' }), 201);
  const blindAssessText = JSON.stringify({ assessed: 'repurchase-v1.0.json', verifier: 'taskBlindVerify', status: 'pass', blind: true });
  let stepBlind = 0;
  provider.setResponder(() => {
    stepBlind += 1;
    if (stepBlind === 1) {
      return hasOsSandbox
        ? { calls: [{ name: 'write', arguments: { path: '../060_reports/repurchase-v1.0-blind-assess.json', content: blindAssessText } }] }
        : { calls: [{ name: 'write_report', arguments: { filename: 'repurchase-v1.0-blind-assess.json', content: blindAssessText } }] };
    }
    if (stepBlind === 2) {
      const assessSha = sha(blindAssessText);
      return {
        calls: [{
          name: 'studio_assets',
          arguments: {
            action: 'assess-use',
            systemId: system.id,
            payload: {
              useId: taskAStudioUseId,
              status: 'pass',
              report: { authority: 'task', id: taskBlindVerify.id, projectId: projAud.id, taskId: taskBlindVerify.id, version: assessSha, sha256: assessSha, locator: '060_reports/repurchase-v1.0-blind-assess.json' },
              sources: [refundV1Ref, sapM1Ref],
              result: '盲签核验反例：未实读原依赖即提交 pass',
            },
          },
        }],
      };
    }
    return { text: '盲签核验任务已提交未实读原依赖的核验单。' };
  });
  await json(await host.request(`/api/projects/${projAud.id}/tasks/${taskBlindVerify.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '盲签反例：不读原资产直接提交核验。',
  }), 202);
  await waitIdle(host, projAud.id, taskBlindVerify.id);
  const packAfterBlind = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}`));
  const useAAfterBlind = packAfterBlind.pack.useRecords.find((u: any) => u.id === autoUseA.id);
  assert.equal(useAAfterBlind.independentVerification.status, 'pending', 'Blind verifier WITHOUT native reads of required assets MUST NEVER promote useRecord to pass!');
  assert.equal(useAAfterBlind.independentVerification.verifierEvidenceSummary?.readRequiredAssetsCount, 0);
  assert.equal(useAAfterBlind.independentVerification.verifierEvidenceSummary?.requiredAssetsCount, 2, 'verifierEvidenceSummary MUST populate requiredAssetsCount (fixes 0/undefined)!');

  // R4 (Round-7): Unbound independent verifier (reads deps + data, but writes an UNRELATED assessment report not referencing target report or recalculation!) -> MUST stay pending!
  const { task: taskUnboundVerify } = await json(await host.request(`/api/projects/${projAud.id}/tasks`, 'POST', { name: '未绑定目标报告反例核验' }), 201);
  const unboundAssessText = JSON.stringify({ note: '无关备忘录，未提及目标报告也无复算数字', ok: true });
  let stepUnbound = 0;
  provider.setResponder(() => {
    stepUnbound += 1;
    if (stepUnbound === 1) return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', systemId: system.id, payload: { ref: refundV1Ref } } }] };
    if (stepUnbound === 2) return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', systemId: system.id, payload: { ref: sapM1Ref } } }] };
    if (stepUnbound === 3) {
      return hasOsSandbox
        ? { calls: [{ name: 'read', arguments: { path: 'starbridge_orders.csv' } }] }
        : { calls: [{ name: 'read_input', arguments: { filename: 'starbridge_orders.csv' } }] };
    }
    if (stepUnbound === 4) {
      return hasOsSandbox
        ? { calls: [{ name: 'write', arguments: { path: '../060_reports/unrelated-memo.json', content: unboundAssessText } }] }
        : { calls: [{ name: 'write_report', arguments: { filename: 'unrelated-memo.json', content: unboundAssessText } }] };
    }
    if (stepUnbound === 5) {
      const assessSha = sha(unboundAssessText);
      return {
        calls: [{
          name: 'studio_assets',
          arguments: {
            action: 'assess-use',
            systemId: system.id,
            payload: {
              useId: taskAStudioUseId,
              status: 'pass',
              report: { authority: 'task', id: taskUnboundVerify.id, projectId: projAud.id, taskId: taskUnboundVerify.id, version: assessSha, sha256: assessSha, locator: '060_reports/unrelated-memo.json' },
              sources: [refundV1Ref, sapM1Ref],
              result: '未绑定目标报告反例',
            },
          },
        }],
      };
    }
    return { text: '已提交未绑定目标报告的无关备忘。' };
  });
  await json(await host.request(`/api/projects/${projAud.id}/tasks/${taskUnboundVerify.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '未绑定报告反例测试。',
  }), 202);
  await waitIdle(host, projAud.id, taskUnboundVerify.id);
  const packAfterUnbound = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}`));
  const useAAfterUnbound = packAfterUnbound.pack.useRecords.find((u: any) => u.id === autoUseA.id);
  assert.equal(useAAfterUnbound.independentVerification.status, 'pending', 'Unbound assessment report not referencing target report/recalculation MUST stay pending!');
  assert.equal(useAAfterUnbound.independentVerification.verifierEvidenceSummary?.assessmentReportBoundToTarget, false);

  const taskAReportRef = {
    authority: 'task' as const,
    id: taskA.id,
    projectId: projStar.id,
    taskId: taskA.id,
    version: sha(reportV1Bytes),
    sha256: sha(reportV1Bytes),
    locator: '060_reports/repurchase-v1.0.json',
  };

  // A note about the policy version cannot replace a read of the exact target report.
  const { task: taskDisclaimerVerify } = await json(await host.request(`/api/projects/${projAud.id}/tasks`, 'POST', { name: '仅提包版未查原报告反例核验' }), 201);
  const disclaimerAssessText = '独立核验说明：仅核对企业包版本 v1.0 制度口径，未查看、未对照原报告内容，也未复核原明细数据。';
  let stepDisc = 0;
  provider.setResponder(() => {
    stepDisc += 1;
    if (stepDisc === 1) return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', systemId: system.id, payload: { ref: refundV1Ref } } }] };
    if (stepDisc === 2) return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', systemId: system.id, payload: { ref: sapM1Ref } } }] };
    if (stepDisc === 3) {
      return hasOsSandbox
        ? { calls: [{ name: 'write', arguments: { path: '../060_reports/policy-only-disclaimer.md', content: disclaimerAssessText } }] }
        : { calls: [{ name: 'write_report', arguments: { filename: 'policy-only-disclaimer.md', content: disclaimerAssessText } }] };
    }
    if (stepDisc === 4) {
      const assessSha = sha(disclaimerAssessText);
      return {
        calls: [{
          name: 'studio_assets',
          arguments: {
            action: 'assess-use',
            systemId: system.id,
            payload: {
              useId: taskAStudioUseId,
              status: 'pass',
              report: { authority: 'task', id: taskDisclaimerVerify.id, projectId: projAud.id, taskId: taskDisclaimerVerify.id, version: assessSha, sha256: assessSha, locator: '060_reports/policy-only-disclaimer.md' },
              sources: [refundV1Ref, sapM1Ref],
              result: '仅提及包版本 v1.0，未查看、未对照原报告',
            },
          },
        }],
      };
    }
    return { text: '已提交仅提包版本、未查看原报告的核验笔记。' };
  });
  await json(await host.request(`/api/projects/${projAud.id}/tasks/${taskDisclaimerVerify.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '仅核查包版本 v1.0，不查看也不对照原报告直接提交通过。',
  }), 202);
  await waitIdle(host, projAud.id, taskDisclaimerVerify.id);
  const packAfterDisc = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}`));
  const useAAfterDisc = packAfterDisc.pack.useRecords.find((u: any) => u.id === autoUseA.id);
  assert.equal(useAAfterDisc.independentVerification.status, 'pending', 'Verifier explicitly stating it never read/compared the original report MUST stay pending!');
  assert.equal(useAAfterDisc.independentVerification.verifierEvidenceSummary?.targetReportChecked, false);
  assert.equal(useAAfterDisc.independentVerification.verifierEvidenceSummary?.assessmentReportBoundToTarget, false);
  assert.equal(useAAfterDisc.independentVerification.verifierEvidenceSummary?.assessmentDisclaimerRejected, true);

  const v1ComparisonEvidence = {
    targetReport: taskAReportRef,
    coverage: { inputPaths: ['020_clean/starbridge_orders.csv'], scope: '星桥直营店9月首购队列，截至2026-10-31', detail: '已核对完整授权窗口和退款记录' },
    comparison: { metrics: [{ name: '分子', reported: 3, recomputed: 3 }, { name: '分母', reported: 4, recomputed: 4 }], facts: '按星桥明细首购和再次购买逐笔核对，原V1规则只扣同月全退' },
  };

  // R4 (Round-8): Input-only verifier (reads deps + CSV, mentions filename & 3/4, but NEVER actually reads target report!) -> MUST stay pending!
  const { task: taskInputOnlyVerify } = await json(await host.request(`/api/projects/${projAud.id}/tasks`, 'POST', { name: '仅读明细未读目标报告反例核验' }), 201);
  const inputOnlyAssessText = JSON.stringify({ assessed: 'repurchase-v1.0.json', status: 'pass', numerator: 3, denominator: 4 });
  let stepIO = 0;
  provider.setResponder(() => {
    stepIO += 1;
    if (stepIO === 1) return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', systemId: system.id, payload: { ref: refundV1Ref } } }] };
    if (stepIO === 2) return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', systemId: system.id, payload: { ref: sapM1Ref } } }] };
    if (stepIO === 3) {
      return hasOsSandbox
        ? { calls: [{ name: 'read', arguments: { path: 'starbridge_orders.csv' } }] }
        : { calls: [{ name: 'read_input', arguments: { filename: 'starbridge_orders.csv' } }] };
    }
    if (stepIO === 4) {
      return hasOsSandbox
        ? { calls: [{ name: 'write', arguments: { path: '../060_reports/input-only-assess.json', content: inputOnlyAssessText } }] }
        : { calls: [{ name: 'write_report', arguments: { filename: 'input-only-assess.json', content: inputOnlyAssessText } }] };
    }
    if (stepIO === 5) {
      const assessSha = sha(inputOnlyAssessText);
      return {
        calls: [{
          name: 'studio_assets',
          arguments: {
            action: 'assess-use',
            systemId: system.id,
            payload: {
              useId: taskAStudioUseId,
              status: 'pass',
              report: { authority: 'task', id: taskInputOnlyVerify.id, projectId: projAud.id, taskId: taskInputOnlyVerify.id, version: assessSha, sha256: assessSha, locator: '060_reports/input-only-assess.json' },
              sources: [refundV1Ref, sapM1Ref],
              result: '仅读明细未实读目标报告反例',
              evidence: v1ComparisonEvidence,
            },
          },
        }],
      };
    }
    return { text: '已提交未实读目标报告的复核记录。' };
  });
  await json(await host.request(`/api/projects/${projAud.id}/tasks/${taskInputOnlyVerify.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '仅读依赖与明细但不实读目标报告。',
  }), 202);
  await waitIdle(host, projAud.id, taskInputOnlyVerify.id);
  const packAfterIO = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}`));
  const useAAfterIO = packAfterIO.pack.useRecords.find((u: any) => u.id === autoUseA.id);
  assert.equal(useAAfterIO.independentVerification.status, 'pending', 'Verifier that never actually read the target report MUST stay pending!');
  assert.equal(useAAfterIO.independentVerification.verifierEvidenceSummary?.targetReportChecked, false);
  assert.equal(useAAfterIO.independentVerification.verifierEvidenceSummary?.authorizedInputChecked, true);

  // Completing a partial read after submitting the assessment cannot qualify that assessment.
  // A later assessment which reads everything still needs a typed comparison or finding.
  const { task: chronologyTask } = await json(await host.request(`/api/projects/${projAud.id}/tasks`, 'POST', { name: '核验调用顺序与比较证据' }), 201);
  const assessmentNote = '核对 repurchase-v1.0.json 的30日规则，3/4。';
  const chronologyReport = {
    authority: 'task', id: chronologyTask.id, projectId: projAud.id, taskId: chronologyTask.id,
    version: sha(assessmentNote), sha256: sha(assessmentNote), locator: '060_reports/assessment-order.md',
  };
  const sourceRead = (ref: unknown, length?: number) => ({
    name: 'studio_assets', arguments: { action: 'read-source', systemId: system.id, payload: { ref, ...(length ? { length } : {}) } },
  });
  const inputRead = (filename: string) => hasOsSandbox
    ? { name: 'read', arguments: { path: filename } }
    : { name: 'read_input', arguments: { filename } };
  const assessmentCall = (evidence?: unknown) => ({
    name: 'studio_assets', arguments: {
      action: 'assess-use', systemId: system.id, payload: {
        useId: taskAStudioUseId, status: 'pass', report: chronologyReport,
        sources: [refundV1Ref, sapM1Ref], result: assessmentNote, ...(evidence ? { evidence } : {}),
      },
    },
  });
  const assessmentWrite = hasOsSandbox
    ? { name: 'write', arguments: { path: '../060_reports/assessment-order.md', content: assessmentNote } }
    : { name: 'write_report', arguments: { filename: 'assessment-order.md', content: assessmentNote } };
  async function runVerifierOrder(calls: (ReturnType<typeof sourceRead> | ReturnType<typeof assessmentCall> | ReturnType<typeof inputRead> | typeof assessmentWrite)[]) {
    let step = 0;
    provider.setResponder(() => {
      const call = calls[step++];
      return call ? { calls: [call] } : { text: '核验回执已提交。' };
    });
    await json(await host.request(`/api/projects/${projAud.id}/tasks/${chronologyTask.id}/messages`, 'POST', {
      requestId: randomUUID(), text: '提交合成核验回执。',
    }), 202);
    await waitIdle(host, projAud.id, chronologyTask.id);
    const response = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}/uses/${autoUseA.id}/verify`, 'POST', {
      requestId: randomUUID(), assessmentReportRef: chronologyReport, independentConfirmed: true,
    }));
    return response.use.independentVerification;
  }
  const tooLate = await runVerifierOrder([
    sourceRead(refundV1Ref), sourceRead(sapM1Ref), sourceRead(taskAReportRef, 4),
    inputRead('starbridge_orders.csv'), assessmentWrite, assessmentCall(v1ComparisonEvidence), sourceRead(taskAReportRef),
  ]);
  assert.equal(tooLate.status, 'pending');
  assert.equal(tooLate.verifierEvidenceSummary.targetReportChecked, false);
  assert.equal(tooLate.verifierEvidenceSummary.authorizedInputChecked, true);
  const noComparison = await runVerifierOrder([
    sourceRead(refundV1Ref), sourceRead(sapM1Ref), sourceRead(taskAReportRef), inputRead('starbridge_orders.csv'),
    assessmentCall({ targetReport: taskAReportRef, coverage: v1ComparisonEvidence.coverage }),
  ]);
  assert.equal(noComparison.status, 'pending');
  assert.equal(noComparison.verifierEvidenceSummary.targetReportChecked, true);
  assert.equal(noComparison.verifierEvidenceSummary.authorizedInputChecked, true);
  assert.match(noComparison.verifierEvidenceSummary.missingReason, /对照结果/);
  const unrelatedInput = await runVerifierOrder([
    sourceRead(refundV1Ref), sourceRead(sapM1Ref), sourceRead(taskAReportRef), inputRead('store-opening-policy.csv'),
    assessmentCall({
      ...v1ComparisonEvidence,
      coverage: { ...v1ComparisonEvidence.coverage, inputPaths: ['020_clean/store-opening-policy.csv'] },
    }),
  ]);
  assert.equal(unrelatedInput.status, 'pending');
  assert.equal(unrelatedInput.verifierEvidenceSummary.targetReportChecked, true);
  assert.equal(unrelatedInput.verifierEvidenceSummary.authorizedInputChecked, false);
  assert.ok(unrelatedInput.verifierActualReads.some((read: any) => read.complete && read.ref.locator === '020_clean/store-opening-policy.csv'));


  // R4 (Round-8): Now run a GENUINE independent verifier task (taskVerifyV1 in projAud) that reads BOTH required dependencies + TARGET REPORT (via studio_assets read-source) + authorized CSV input data, writes assessment bound to target report + SHA-256 + recalculation, and calls assess-use!
  const { task: taskVerifyV1 } = await json(await host.request(`/api/projects/${projAud.id}/tasks`, 'POST', { name: '独立核验任务V1' }), 201);
  const indepAssessV1Text = JSON.stringify({ assessed: 'repurchase-v1.0.json', targetSha256: sha(reportV1Bytes), verifier: 'taskVerifyV1', status: 'pass', numerator: 3, denominator: 4 });
  let stepVV1 = 0;
  let indepAssessV1Ok = false;
  provider.setResponder(context => {
    stepVV1 += 1;
    if (stepVV1 === 1) {
      return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', systemId: system.id, payload: { ref: refundV1Ref } } }] };
    }
    if (stepVV1 === 2) {
      return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', systemId: system.id, payload: { ref: sapM1Ref } } }] };
    }
    if (stepVV1 === 3) {
      return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', systemId: system.id, payload: { ref: taskAReportRef } } }] };
    }
    if (stepVV1 === 4) {
      return hasOsSandbox
        ? { calls: [{ name: 'read', arguments: { path: 'starbridge_orders.csv' } }] }
        : { calls: [{ name: 'read_input', arguments: { filename: 'starbridge_orders.csv' } }] };
    }
    if (stepVV1 === 5) {
      return hasOsSandbox
        ? { calls: [{ name: 'write', arguments: { path: '../060_reports/repurchase-v1.0-indep-assess.json', content: indepAssessV1Text } }] }
        : { calls: [{ name: 'write_report', arguments: { filename: 'repurchase-v1.0-indep-assess.json', content: indepAssessV1Text } }] };
    }
    if (stepVV1 === 6) {
      const assessSha = sha(indepAssessV1Text);
      return {
        calls: [{
          name: 'studio_assets',
          arguments: {
            action: 'assess-use',
            systemId: system.id,
            payload: {
              useId: taskAStudioUseId,
              status: 'pass',
              report: { authority: 'task', id: taskVerifyV1.id, projectId: projAud.id, taskId: taskVerifyV1.id, version: assessSha, sha256: assessSha, locator: '060_reports/repurchase-v1.0-indep-assess.json' },
              sources: [refundV1Ref, sapM1Ref],
              result: '独立核验任务 taskVerifyV1 实读 v1.0 原文、目标报告 repurchase-v1.0.json 与星桥明细并核对 3/4 复算通过',
              evidence: v1ComparisonEvidence,
            },
          },
        }],
      };
    }
    const resTxt = providerMessageText(context.recentToolResults.at(-1)!.content);
    indepAssessV1Ok = resTxt.includes('"status":"pass"');
    return { text: '独立核验任务已完成对 Task A v1.0 报告的独立实读与 assess-use。' };
  });
  await json(await host.request(`/api/projects/${projAud.id}/tasks/${taskVerifyV1.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '请作为独立核验任务先实读适用原依赖、Task A 原报告与授权明细，再完成独立复核。',
  }), 202);
  await waitIdle(host, projAud.id, taskVerifyV1.id);
  assert.equal(indepAssessV1Ok, true, 'Independent verifier task studio_assets assess-use MUST be accepted by StudioStore!');
  const packAfterIndepV1 = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}`));
  const useAAfterIndep = packAfterIndepV1.pack.useRecords.find((u: any) => u.id === autoUseA.id);
  assert.equal(useAAfterIndep.independentVerification.status, 'pass', 'Genuine independent verifier task assess-use MUST promote Task A useRecord to pass!');
  assert.equal(useAAfterIndep.independentVerification.verifierTaskId, taskVerifyV1.id);
  assert.equal(useAAfterIndep.independentVerification.selfAssessmentOnly, false);
  assert.equal(useAAfterIndep.independentVerification.verifierEvidenceSummary?.requiredAssetsCount, 2);
  assert.equal(useAAfterIndep.independentVerification.verifierEvidenceSummary?.readRequiredAssetsCount, 2);
  assert.equal(useAAfterIndep.independentVerification.verifierEvidenceSummary?.targetReportChecked, true);
  assert.equal(useAAfterIndep.independentVerification.verifierEvidenceSummary?.authorizedInputChecked, true);
  assert.ok((useAAfterIndep.independentVerification.verifierEvidenceSummary?.targetReportReadTurnIndex ?? 0) >= 1);
  assert.equal(useAAfterIndep.independentVerification.verifierEvidenceSummary?.hadDataOrCalcEvidence, true);
  assert.equal(useAAfterIndep.independentVerification.verifierEvidenceSummary?.assessmentReportBoundToTarget, true);
  assert.equal(useAAfterIndep.independentVerification.verifierEvidenceSummary?.assessmentDisclaimerRejected, false);
  assert.ok((useAAfterIndep.independentVerification.verifierEvidenceSummary?.assessmentTurnIndex ?? 0) >= 1);
  const verifierAState = await json(await host.request(`/api/projects/${projAud.id}/tasks/${taskVerifyV1.id}`));
  const assessorMessage = verifierAState.snapshot.messages.find((m: any) => m.role === 'assistant' && m.content?.some((c: any) => c.type === 'toolCall' && c.name === 'studio_assets' && c.arguments?.action === 'assess-use'));
  assert.ok(assessorMessage?.nativeEntryId);
  assert.equal(useAAfterIndep.independentVerification.verifierEvidenceSummary.assessmentMessageId, assessorMessage.nativeEntryId);
  assert.equal(useAAfterIndep.independentVerification.verifierEvidenceSummary.assessmentSessionId, verifierAState.snapshot.sessionId);


  // R4 (Round-6): Verify GET /api/studio/enterprise-packs/turn-evidence & /report-snapshot link Task A's turn to saved report + pass verdict!
  const turnEvidenceRoute = `/api/studio/enterprise-packs/turn-evidence?projectId=${projStar.id}&taskId=${taskA.id}`;
  assert.equal((await host.request(turnEvidenceRoute)).status, 403);
  const turnEvA = await json(await projectReq(projStar.id, turnEvidenceRoute));
  assert.ok(turnEvA.savedReports.some((r: any) => r.locator === '060_reports/repurchase-v1.0.json'), 'turn-evidence MUST list Task A saved report!');
  assert.ok(turnEvA.useRecords.some((r: any) => r.use.id === autoUseA.id && r.use.independentVerification.status === 'pass'), 'turn-evidence MUST surface REAL independent verification pass verdict!');
  const snapA = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}/report-snapshot?projectId=${projStar.id}&taskId=${taskA.id}&locator=${encodeURIComponent('060_reports/repurchase-v1.0.json')}&sha256=${sha(reportV1Bytes)}`));
  assert.equal(snapA.sha256, sha(reportV1Bytes));
  assert.equal(snapA.text, reportV1Bytes.toString('utf8'));

  // R5 (Round-5): Same-task subsequent same-name report overwrite protection + Cross-task same-name protection!
  // 1) Same task (Task A) writing modified repurchase-v1.0.json MUST NEVER overwrite the already-recorded original!
  if (hasOsSandbox) {
    let stepASame = 0;
    provider.setResponder(() => {
      stepASame += 1;
      if (stepASame === 1) {
        return { calls: [{ name: 'bash', arguments: { command: `python3 -c "import json; open('../060_reports/repurchase-v1.0.json','w').write(json.dumps({'packVersion':'1.0','owner':'taskA-revised','numerator':77}))"` } }] };
      }
      return { text: '同任务再次写出同名更正稿。' };
    });
    await json(await host.request(`/api/projects/${projStar.id}/tasks/${taskA.id}/messages`, 'POST', {
      requestId: randomUUID(), text: '同任务尝试用同名文件写出更正版。',
    }), 202);
    await waitIdle(host, projStar.id, taskA.id, stateA.snapshot.messages.length + 2);
    assert.equal(sha(fs.readFileSync(reportV1Path)), sha(reportV1Bytes), 'Same-task subsequent same-name revision MUST NEVER overwrite Studio-referenced original report!');
    const sameTaskAlt = path.join(projStar.rootPath, '060_reports', `repurchase-v1.0.task-${taskA.id.slice(0, 8)}.json`);
    assert.equal(fs.existsSync(sameTaskAlt), true, 'Same-task revised same-name report MUST be preserved separately!');
    assert.equal(JSON.parse(fs.readFileSync(sameTaskAlt, 'utf8')).owner, 'taskA-revised');
  } else {
    // Even via write_report directly OR workspace sync, original report MUST NEVER be overwritten!
    let stepASame = 0;
    let overwriteBlocked = false;
    provider.setResponder(context => {
      stepASame += 1;
      if (stepASame === 1) {
        return { calls: [{ name: 'write_report', arguments: { filename: 'repurchase-v1.0.json', content: JSON.stringify({ owner: 'taskA-revised', numerator: 77 }) } }] };
      }
      const txt = providerMessageText(context.recentToolResults.at(-1)!.content);
      overwriteBlocked = txt.includes('report_name_conflict') || txt.includes('already exists');
      return { text: 'write_report 拒绝覆盖同名原报告。' };
    });
    await json(await host.request(`/api/projects/${projStar.id}/tasks/${taskA.id}/messages`, 'POST', {
      requestId: randomUUID(), text: '同任务尝试覆盖已引用的同名报告。',
    }), 202);
    await waitIdle(host, projStar.id, taskA.id, stateA.snapshot.messages.length + 2);
    assert.equal(overwriteBlocked, true, 'write_report MUST refuse to overwrite an existing report!');
    assert.equal(sha(fs.readFileSync(reportV1Path)), sha(reportV1Bytes), 'Original report bytes MUST remain 100% untouched!');
  }

  const { task: taskA2 } = await json(await host.request(`/api/projects/${projStar.id}/tasks`, 'POST', { name: '同名报告保护反例任务' }), 201);
  let sameNameStep = 0;
  const sameNameReport = JSON.stringify({ packVersion: '1.0', owner: 'taskA2', numerator: 99 });
  const altName = `repurchase-v1.0.task-${taskA2.id.slice(0, 8)}.json`;
  provider.setResponder(() => {
    sameNameStep += 1;
    if (sameNameStep === 1) {
      return hasOsSandbox
        ? { calls: [{ name: 'write', arguments: { path: '../060_reports/repurchase-v1.0.json', content: sameNameReport } }] }
        : { calls: [{ name: 'write_report', arguments: { filename: 'repurchase-v1.0.json', content: sameNameReport } }] };
    }
    if (!hasOsSandbox && sameNameStep === 2) {
      return { calls: [{ name: 'write_report', arguments: { filename: altName, content: sameNameReport } }] };
    }
    return { text: '已生成同名报告冲突测试完成。' };
  });
  await json(await host.request(`/api/projects/${projStar.id}/tasks/${taskA2.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '同步同名报告保护测试。',
  }), 202);
  await waitIdle(host, projStar.id, taskA2.id);
  assert.equal(sha(fs.readFileSync(reportV1Path)), sha(reportV1Bytes), 'Second task writing same-name report MUST NEVER overwrite Task A original report!');
  const conflictCopyPath = path.join(projStar.rootPath, '060_reports', altName);
  assert.equal(fs.existsSync(conflictCopyPath), true, 'Second task same-name report MUST be preserved under conflict-free filename!');
  assert.equal(JSON.parse(fs.readFileSync(conflictCopyPath, 'utf8')).owner, 'taskA2');

  const assistantMsgA = [...stateA.snapshot.messages].reverse().find((m: any) => m.role === 'assistant' && m.nativeEntryId && m.nativeSessionId);
  assert.ok(assistantMsgA);

  // R4.1 COUNTEREXAMPLE: Send zero-tool turn on Task A -> BOTH feedback AND /uses MUST NOT borrow Turn 1 reads or declare-use!
  const beforeZeroTool = (await json(await host.request(`/api/projects/${projStar.id}/tasks/${taskA.id}`))).snapshot.messages.length;
  provider.setResponder(() => ({ text: '本轮未调用任何工具，仅做纯文字补充讨论。' }));
  await json(await host.request(`/api/projects/${projStar.id}/tasks/${taskA.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '不用查工具，简单总结一下刚才的思路。',
  }), 202);
  const stateATurn2 = await waitIdle(host, projStar.id, taskA.id, beforeZeroTool + 2);
  const assistantMsgATurn2 = [...stateATurn2.snapshot.messages].reverse().find((m: any) => m.role === 'assistant' && m.nativeEntryId && m.nativeSessionId);
  assert.ok(assistantMsgATurn2 && assistantMsgATurn2.nativeEntryId !== assistantMsgA.nativeEntryId);
  const useTurn2Borrow = await json(await projectReq(projStar.id, `/api/studio/enterprise-packs/${packId}/uses`, 'POST', {
    requestId: randomUUID(),
    projectId: projStar.id,
    taskId: taskA.id,
    sessionId: assistantMsgATurn2.nativeSessionId,
    messageId: assistantMsgATurn2.nativeEntryId,
    purposeId: purpose.id,
    accessLevel: 'recalculate',
    authorDeclaration: {
      declaredPurposeId: purpose.id,
      declaredRefs: [refundV1Ref, sapM1Ref],
      summaryText: '试图在无工具轮次伪造 authorDeclaration 并借用第一轮实读',
      declaredAt: new Date().toISOString(),
    },
    reportRef: {
      authority: 'task',
      id: taskA.id,
      projectId: projStar.id,
      taskId: taskA.id,
      version: sha(reportV1Bytes),
      sha256: sha(reportV1Bytes),
      locator: '060_reports/repurchase-v1.0.json',
    },
  }));
  assert.deepEqual(useTurn2Borrow.use.actualReads, [], 'Zero-tool turn MUST NOT borrow Turn 1 reads in /uses!');
  assert.equal(useTurn2Borrow.use.authorDeclaration, undefined, 'Forged client authorDeclaration MUST be ignored when turn had no native declare-use!');
  const verifyTurn2Borrow = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}/uses/${useTurn2Borrow.use.id}/verify`, 'POST', {
    requestId: randomUUID(),
    verifierRole: '独立复核',
    expectedRef: refundV1Ref,
    independentConfirmed: true,
    verdictDetail: '无读取轮次试图借用第一轮通过',
  }));
  assert.equal(verifyTurn2Borrow.use.independentVerification.status, 'pending', 'Zero-tool turn MUST NEVER achieve pass by borrowing Turn 1!');
  const fbZeroToolTurn = await json(await projectReq(projStar.id, `/api/studio/enterprise-packs/${packId}/feedback`, 'POST', {
    requestId: randomUUID(),
    origin: { projectId: projStar.id, taskId: taskA.id, sessionId: assistantMsgATurn2.nativeSessionId, messageId: assistantMsgATurn2.nativeEntryId },
    problemKey: 'zero-tool-turn-isolation',
    title: '无工具调用轮次不继承前轮实读反例',
    category: 'member_policy',
    evidenceNote: '本轮无任何工具调用',
  }));
  assert.notEqual(fbZeroToolTurn.feedback.reports[0].adoptionBasis, 'verified_actual_read', 'Tool-free turn MUST NEVER inherit Turn 1 actualReads!');
  assert.equal(fbZeroToolTurn.feedback.reports[0].usedPackVersion, undefined);
  assert.deepEqual(fbZeroToolTurn.feedback.reports[0].usedAssetRefs, []);

  // R5 (Round-6): Create a real Case in CaseStore linked to projStar so feedback auto-binds originalCaseRef and closure verifies original Case preservation!
  await json(await host.request('/api/cases/storage/initialize', 'POST', {}));
  const caseCreated = await json(await host.request('/api/cases', 'POST', await withCaseGoal(host, {
    operationId: randomUUID(),
    title: 'Q4 星桥复购经营决定 Case',
    description: '基于 2026-10-31 截止日复购报告作出的门店运营决策',
  })), 201);
  const origCase = caseCreated.case;
  const linkCaseRes = await host.request(`/api/cases/${origCase.id}/projects`, 'POST', {
    operationId: randomUUID(),
    projectId: projStar.id,
    expectedRevision: origCase.revision,
  });
  assert.ok(linkCaseRes.status >= 200 && linkCaseRes.status < 300, `Linking Case to projStar failed: ${linkCaseRes.status}`);
  const origDecisionRes = await seedCaseDecisionAndRestart({
    caseId: origCase.id,
    expectedRevision: 0,
    title: '星桥十月截止复购激励决策 rev1',
    proposal: '基于 2026-10-31 截止日报告维持当前会员权益方案，后续跟进11月退款映射修订',
    projectId: projStar.id,
    taskId: taskA.id,
    references: [{
      relation: 'derived_from',
      target: { type: 'source', source: {
        type: 'native-reply', projectId: projStar.id, taskId: taskA.id,
        sessionId: assistantMsgA.nativeSessionId, messageId: assistantMsgA.nativeEntryId,
        expectedTextSha256: sha(providerMessageText(assistantMsgA.content)),
      } },
      note: null,
    }],
  });
  const origDecisionId = origDecisionRes.recordId;
  assert.equal(origDecisionRes.revision, 1);

  // Submit feedback from Task A's Turn 1 native reply twice -> verified_actual_read + usedPackVersion='1.0' + linked saved report + originalCaseRef (pinned decisionId + rev.1!) + dedupe!
  const originA = { projectId: projStar.id, taskId: taskA.id, sessionId: assistantMsgA.nativeSessionId, messageId: assistantMsgA.nativeEntryId };
  const fb1 = await json(await projectReq(projStar.id, `/api/studio/enterprise-packs/${packId}/feedback`, 'POST', {
    requestId: randomUUID(), origin: originA, problemKey: 'cross-month-refund', title: '跨月全额退款漏连原单',
    category: 'shared_refund_mapping', evidenceNote: '账号 C07 10月2日全额退款未冲销9月再购 O-73',
    taskCutoffAt: '2026-11-15',
  }));
  const fb2 = await json(await projectReq(projStar.id, `/api/studio/enterprise-packs/${packId}/feedback`, 'POST', {
    requestId: randomUUID(), origin: originA, problemKey: 'cross-month-refund', title: '跨月全额退款漏连原单',
    category: 'shared_refund_mapping', evidenceNote: '确认 10月2日退款在截止日 10月31日前已可见',
  }));
  assert.equal(fb1.created, true);
  assert.equal(fb2.created, false);
  assert.equal(fb2.feedback.id, fb1.feedback.id);
  assert.equal(fb2.feedback.reports.length, 2);
  assert.equal(fb1.feedback.reports[0].adoptionBasis, 'verified_actual_read');
  assert.equal(fb1.feedback.reports[0].usedPackVersion, '1.0');
  assert.equal(fb1.feedback.reports[0].taskCutoffAt, '2026-10-31');
  assert.equal(fb1.feedback.reports[0].reportRef.locator, '060_reports/repurchase-v1.0.json', 'Feedback reportRef MUST link to the same-turn saved report file!');
  assert.ok(fb1.feedback.reports[0].replyRef?.locator?.includes('native-reply'), 'Feedback MUST preserve original replyRef alongside saved reportRef!');
  assert.equal(fb1.feedback.reports[0].linkedUseRecordId, autoUseA.id);
  assert.equal(fb1.feedback.reports[0].independentVerificationStatus, 'pass');
  assert.equal(fb1.feedback.reports[0].originalCaseRef?.caseId, origCase.id, 'Feedback MUST auto-link original Case from CaseStore!');
  assert.equal(fb1.feedback.reports[0].originalCaseRef?.decisionId, origDecisionId, 'Feedback MUST auto-pin original Case decisionId!');
  assert.equal(fb1.feedback.reports[0].originalCaseRef?.decisionRevision, 1, 'Feedback MUST auto-pin exact original Case decisionRevision=1!');
  assert.equal(fb1.feedback.targetAssetRef.id, refundV1Ref.id);

  // R5.3 COUNTEREXAMPLE: Attempting to close fb1 using Task A's OWN v1.0 pass use record MUST be rejected (409)!
  const badSameTaskClose = await ownerReq(`/api/studio/enterprise-packs/${packId}/feedback/${fb1.feedback.id}/handle`, 'POST', {
    requestId: randomUUID(),
    projectId: projBuild.id,
    status: 'verified',
    note: '试图用同任务同旧版假闭环',
    verifiedByUseId: autoUseA.id,
  });
  assert.equal(badSameTaskClose.status, 409, 'Same task / same old version MUST NOT be allowed to close feedback as verified!');

  // Route feedback to original authority (creates real linked Studio workItem & feedback!)
  const routed = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}/feedback/${fb1.feedback.id}/handle`, 'POST', {
    requestId: randomUUID(),
    projectId: projBuild.id,
    status: 'investigating',
    note: '转入原 SAP 方法库修订跨月全额退款映射，仅重核受影响复购用途',
    impactedPurposeIds: [purpose.id],
  }));
  assert.equal(routed.feedback.status, 'investigating');
  assert.ok(routed.feedback.authorityHandling.studioWorkItemId);

  // --- 2D. Revise original authorities (SAP Method v2 + SAP Metric 1.1.0) & publish Pack v1.1 ---
  const methodV2 = await json(await host.request(`/api/sap/methods/${methodV1.method.id}/versions`, 'POST', {
    requestId: randomUUID(),
    baseVersion: 1,
    title: '销售退款映射规则（跨月原单关联口径 v2）',
    content: {
      conditions: '岚线直营门店 2026-09 销售与截至 2026-10-31 的全部退款流水',
      logic: 'v2口径：按原订单号冲销截至数据截止日的全部当月及跨月全额退款',
      judgment: '扣除跨月全额退款后净有效再购 > 0 计为复购',
      limits: '限于截至数据截止日已入账退款',
    },
    sources: [],
  }), 201);
  await json(await host.request(`/api/sap/methods/${methodV1.method.id}/publish`, 'POST', {
    requestId: randomUUID(), version: 2, expectedSha256: methodV2.version.contentSha256,
  }));
  const refundV2Ref = {
    authority: 'sap-method' as const,
    id: methodV1.method.id,
    version: '2',
    sha256: methodV2.version.contentSha256,
    title: '销售退款映射规则 v2',
  };

  const v2SapYaml = baseSapYaml
    .replace('version: 1.0.0', 'version: 1.1.0')
    .replace('指定时间窗口内', '跨月全额退款原单冲销后指定时间窗口内');
  fs.writeFileSync(path.join(projBuild.rootPath, '020_clean', 'repurchase-v2.sap.yaml'), v2SapYaml);
  const valV2 = await json(await host.request('/api/metric-factory/draft/validate', 'POST', {
    projectId: projBuild.id, path: '020_clean/repurchase-v2.sap.yaml',
  }));
  const sapPubV2 = await json(await host.request('/api/metric-factory/publish', 'POST', {
    projectId: projBuild.id, path: '020_clean/repurchase-v2.sap.yaml', publishedBy: 'synthetic-reviewer', expectedPackageFingerprint: valV2.packageFingerprint,
  }), 201);
  const sapM2Ref = {
    authority: 'sap-metric' as const,
    id: sapPubV2.entry.id,
    version: '1.1.0',
    sha256: sapPubV2.entry.bytesSha256,
    title: '复购指标 1.1.0',
  };

  await json(await ownerReq(`/api/studio/enterprise-packs/${packId}/purposes`, 'POST', {
    requestId: randomUUID(), projectId: projBuild.id,
    purposeKey: 'store-first-purchase-30d-repurchase', title: '门店首购后 30 日有效复购率',
    businessQuestion: '9 月星桥首购队列 30 日复购率', subjectUnit: 'brand_account', windowDays: 30,
    scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店'], period: '2026-09', scopeKey: 'lanxian:direct:starbridge:2026-09' },
    tier: 'formal-calculation', businessStatus: 'active', originalGoal: '核算 9 月星桥复购',
    exclusions: ['未成熟观察窗'], completionCriteria: '核清分子分母',
    evidenceReadiness: { definition: 'pass', mapping: 'pass', sampleCalculation: 'pass' },
    dependencies: [
      { id: 'dep-refund', role: 'shared-asset', authority: 'sap-method', ref: refundV2Ref, requiredFor: ['formal-calculation'] },
      { id: 'dep-sap', role: 'sap-metric', authority: 'sap-metric', ref: sapM2Ref, requiredFor: ['formal-calculation'] },
    ],
    policyEffectiveFrom: '2026-09-01', dataCutoffAt: '2026-10-31', observationWindowDays: 30, availableHistoryDays: 60,
  }));
  const { preview: prev2 } = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}/previews`, 'POST', {
    requestId: randomUUID(), projectId: projBuild.id, version: '1.1', previousVersion: '1.0', purposeIds: [purpose.id],
    policyEffectiveFrom: '2026-09-01', dataCutoffAt: '2026-10-31', summary: '跨月退款修订 v1.1',
  }));
  const conf2 = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}/confirm`, 'POST', {
    requestId: randomUUID(), projectId: projBuild.id, previewId: prev2.id, fingerprint: prev2.fingerprint, confirmedBy: '会员运营负责人',
  }));
  assert.equal(conf2.revision.purposeManifests[0].status, 'eligible');

  // Verify Task A stays pinned on v1.0 and can STILL read historical pinned refundV1Ref!
  let stepA3 = 0;
  let taskAStillV1 = false;
  provider.setResponder(context => {
    stepA3 += 1;
    if (stepA3 === 1) return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', payload: { ref: refundV1Ref } } }] };
    const txt = providerMessageText(context.recentToolResults.at(-1)!.content);
    taskAStillV1 = txt.includes('v1口径') && txt.includes('"packVersion":"1.0"');
    return { text: '历史任务继续按原固定版 v1.0 回查历史退款规则 v1。' };
  });
  await json(await host.request(`/api/projects/${projStar.id}/tasks/${taskA.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '复核本任务固定版 v1.0 的原退款规则。',
  }), 202);
  const stateATurn3 = await waitIdle(host, projStar.id, taskA.id, stateATurn2.snapshot.messages.length + 2);
  assert.equal(taskAStillV1, true, 'Existing Task A MUST remain pinned to v1.0 and able to read pinned refundV1Ref after v1.1 publish!');

  // R2.4 LIVE REVOCATION PURGE: Revoke projStar's grant mid-session -> verify starbridge_orders.csv is IMMEDIATELY blocked in-session (and purged from sandbox on macOS)!
  await json(await ownerReq(`/api/studio/resource-grants/${starGrantId}/revoke`, 'POST', {
    requestId: randomUUID(), revokerProjectId: projBuild.id, authorityToken: buildAuth.authorityToken, reason: '运行中即时撤回验证',
  }));
  assert.equal(fs.existsSync(path.join(sandboxCleanDir, 'starbridge_orders.csv')), false, 'Revoking detail grant MUST leave zero starbridge_orders.csv in active restricted task sandbox!');
  let stepA4 = 0;
  let afterRevokeBlocked = false;
  provider.setResponder(context => {
    stepA4 += 1;
    if (stepA4 === 1) {
      return hasOsSandbox
        ? { calls: [{ name: 'read', arguments: { path: 'starbridge_orders.csv' } }] }
        : { calls: [{ name: 'read_input', arguments: { filename: 'starbridge_orders.csv' } }] };
    }
    const txt = providerMessageText(context.recentToolResults.at(-1)!.content);
    afterRevokeBlocked = txt.includes('detail_access_not_authorized') || txt.includes('禁止读取项目 020_clean') || txt.includes('no_active_grant_for_read_detail_recalculate') || txt.includes('not_authorized') || txt.includes('ENOENT') || txt.includes('No such file');
    return { text: '授权撤回后实时会话已立即拦截明细读取。' };
  });
  await json(await host.request(`/api/projects/${projStar.id}/tasks/${taskA.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '检查授权撤回后是否还能读取本店明细文件。',
  }), 202);
  await waitIdle(host, projStar.id, taskA.id, stateATurn3.snapshot.messages.length + 2);
  assert.equal(afterRevokeBlocked, true, 'Revoking detail grant MUST immediately block detail reads in the active session!');

  // Run brand-new independent Task B discovering v1.1 + Turn 2 continuation (verifying macOS Turn 2 NEVER hits protected_executor_draining!)
  const { task: taskB } = await json(await host.request(`/api/projects/${projAud.id}/tasks`, 'POST', { name: '独立新任务核对新版' }), 201);
  const reportV2BodyText = JSON.stringify({
    packVersion: '1.1',
    numerator: 2,
    denominator: 4,
    accounts: ['C13', 'C21'],
    c07Excluded: true,
    c13Retained: true,
    itemChecks: { shouldChange: ['C07'], shouldRetain: ['C13'] },
    transactions: [
      transaction('C07', 'O-73', '冲销排除'),
      transaction('C13', 'O-81', '计入复购'),
      transaction('C21', 'O-88', '计入复购'),
    ],
  });
  let stepB = 0;
  let taskBCatalogText = '';
  let refundV2ReadText = '';
  let sapM2ReadText = '';
  provider.setResponder(context => {
    stepB += 1;
    if (stepB === 1) return { calls: [{ name: 'studio_assets', arguments: { action: 'catalog' } }] };
    if (stepB === 2) {
      taskBCatalogText = providerMessageText(context.recentToolResults.at(-1)!.content);
      return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', payload: { ref: refundV2Ref } } }] };
    }
    if (stepB === 3) {
      refundV2ReadText = providerMessageText(context.recentToolResults.at(-1)!.content);
      return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', payload: { ref: sapM2Ref } } }] };
    }
    if (stepB === 4) {
      sapM2ReadText = providerMessageText(context.recentToolResults.at(-1)!.content);
      if (hasOsSandbox) {
        const pyCmd = `python3 -c "import csv, hashlib, json; rows = list(csv.DictReader(open('starbridge_orders.csv'))); rep = [r['account'] for r in rows if r['repeat_order_id'] and not (r['full_refund']=='true' and r['refund_date'] <= '2026-10-31')]; body = json.dumps({'packVersion':'1.1','numerator':len(rep),'denominator':len(rows),'accounts':rep,'transactions':[{'itemId':r['account'],'originalOrderId':r['repeat_order_id'],'disposition':'计入复购' if r['account'] in rep else '冲销排除'} for r in rows if r['repeat_order_id']],'c07Excluded':'C07' not in rep,'c13Retained':'C13' in rep,'itemChecks':{'shouldChange':['C07'],'shouldRetain':['C13']}}, ensure_ascii=False).encode(); open('../060_reports/repurchase-v1.1.json','wb').write(body); print('REP2_SHA=' + hashlib.sha256(body).hexdigest())"`;
        return { calls: [{ name: 'bash', arguments: { command: pyCmd } }] };
      }
      return { calls: [{ name: 'write_report', arguments: { filename: 'repurchase-v1.1.json', content: reportV2BodyText } }] };
    }
    return { text: '独立新任务已查读 v1.1（销售退款映射 v2 + 复购指标 1.1.0）并完成复算：C07 跨月全额退款排除（应变），C13 有效再购保留（应保留），9 月星桥复购率为 2/4，结果已写入 060_reports/repurchase-v1.1.json。' };
  });
  await json(await host.request(`/api/projects/${projAud.id}/tasks/${taskB.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '请独立核查 9 月星桥门店复购（数据截止 2026-10-31），核对 C07 与 C13。',
  }), 202);
  const stateB = await waitIdle(host, projAud.id, taskB.id);
  assert.match(taskBCatalogText, /"pinnedVersion":"1\.1"/);
  assert.match(refundV2ReadText, /v2口径：按原订单号冲销/);
  assert.match(sapM2ReadText, /跨月全额退款原单冲销后/);
  assert.deepEqual(provider.errors, []);

  const reportV2Bytes = fs.readFileSync(path.join(projAud.rootPath, '060_reports', 'repurchase-v1.1.json'));
  const reportV2Json = JSON.parse(reportV2Bytes.toString('utf8'));
  assert.equal(reportV2Json.numerator, 2);
  assert.equal(reportV2Json.denominator, 4);
  assert.equal(reportV2Json.c07Excluded, true);
  assert.equal(reportV2Json.c13Retained, true);

  const assistantMsgB = [...stateB.snapshot.messages].reverse().find((m: any) => m.role === 'assistant' && m.nativeEntryId && m.nativeSessionId);
  assert.ok(assistantMsgB);

  // R4.2 COUNTEREXAMPLE: Client-supplied authorDeclaration without native declare-use MUST be ignored & verify MUST stay pending!
  const useBNoDecl = await json(await projectReq(projAud.id, `/api/studio/enterprise-packs/${packId}/uses`, 'POST', {
    requestId: randomUUID(),
    projectId: projAud.id,
    taskId: taskB.id,
    sessionId: assistantMsgB.nativeSessionId,
    messageId: assistantMsgB.nativeEntryId,
    purposeId: purpose.id,
    accessLevel: 'recalculate',
    authorDeclaration: {
      declaredPurposeId: purpose.id,
      declaredRefs: [refundV2Ref, sapM2Ref],
      summaryText: '客户端伪造声明（原会话未调用 declare-use）',
      declaredAt: new Date().toISOString(),
    },
    reportRef: {
      authority: 'task',
      id: taskB.id,
      projectId: projAud.id,
      taskId: taskB.id,
      version: sha(reportV2Bytes),
      sha256: sha(reportV2Bytes),
      locator: '060_reports/repurchase-v1.1.json',
    },
  }));
  assert.equal(useBNoDecl.use.authorDeclaration, undefined, 'Client-supplied authorDeclaration MUST be ignored without native declare-use!');
  const verifyNoDecl = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}/uses/${useBNoDecl.use.id}/verify`, 'POST', {
    requestId: randomUUID(),
    verifierRole: '独立核算复核',
    expectedRef: refundV2Ref,
    independentConfirmed: true,
    verdictDetail: '无原生 declare-use/assess-use 反例',
  }));
  assert.equal(verifyNoDecl.use.independentVerification.status, 'pending', 'Missing native declare-use & disk-verified assess-use MUST keep verdict pending!');

  const undeclaredFeedback = await json(await projectReq(projAud.id, `/api/studio/enterprise-packs/${packId}/feedback`, 'POST', {
    requestId: randomUUID(),
    origin: { projectId: projAud.id, taskId: taskB.id, sessionId: assistantMsgB.nativeSessionId, messageId: assistantMsgB.nativeEntryId },
    problemKey: 'feedback-without-report-adoption',
    title: '查阅来源但未将其登记为报告依据',
    evidenceNote: '旧回复的来源阅读没有作为报告采用证据。',
    category: 'shared_refund_mapping',
  }));
  assert.equal(undeclaredFeedback.feedback.reports[0].adoptionBasis, 'directory_only_unverified');
  assert.equal(undeclaredFeedback.feedback.reports[0].usedPackVersion, undefined);
  assert.equal(undeclaredFeedback.feedback.targetAssetRef, undefined);

  // Run Task B Turn 2 (proves Mac mini Turn-2 continuation writes cleanly WITHOUT protected_executor_draining!) with real native read-source + declare-use!
  let stepB2 = 0;
  let taskBStudioUseId = '';
  let turn2WriteOk = false;
  provider.setResponder(context => {
    stepB2 += 1;
    if (stepB2 === 1) return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', payload: { ref: refundV2Ref } } }] };
    if (stepB2 === 2) return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', payload: { ref: sapM2Ref } } }] };
    if (stepB2 === 3) return { calls: [{ name: 'read_input', arguments: { filename: 'starbridge_orders.csv' } }] };
    if (stepB2 === 4) {
      return {
        calls: [{
          name: 'studio_assets',
          arguments: {
            action: 'declare-use',
            systemId: system.id,
            payload: {
              report: {
                authority: 'task',
                id: taskB.id,
                projectId: projAud.id,
                taskId: taskB.id,
                version: sha(reportV2Bytes),
                sha256: sha(reportV2Bytes),
                locator: '060_reports/repurchase-v1.1.json',
              },
              sources: [refundV2Ref, sapM2Ref],
              result: '独立新任务原生 declare-use：按 v1.1 核得星桥 2/4（C07 排除、C13 保留）',
            },
          },
        }],
      };
    }
    if (stepB2 === 5) {
      const declRes = JSON.parse(providerMessageText(context.recentToolResults.at(-1)!.content));
      taskBStudioUseId = declRes?.use?.id;
      assert.ok(taskBStudioUseId);
      if (hasOsSandbox) {
        const pyNote = `python3 -c "import json; open('../060_reports/repurchase-v1.1-turn2-note.json','w').write(json.dumps({'turn2Continuation':'ok','packVersion':'1.1'}))"`;
        return { calls: [{ name: 'bash', arguments: { command: pyNote } }] };
      }
      return { calls: [{ name: 'write_report', arguments: { filename: 'repurchase-v1.1-turn2-note.json', content: JSON.stringify({ turn2Continuation: 'ok', packVersion: '1.1' }) } }] };
    }
    const turn2ResTxt = providerMessageText(context.recentToolResults.at(-1)!.content);
    turn2WriteOk = !turn2ResTxt.includes('protected_executor_draining') && !turn2ResTxt.includes('error') && !turn2ResTxt.includes('failed');
    return { text: '已完成 v1.1 原生 declare-use 且第二轮受限工作区写入成功（无 protected_executor_draining）。' };
  });
  await json(await host.request(`/api/projects/${projAud.id}/tasks/${taskB.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '请按数据截止 2026-10-31 查读原明细，对 060_reports/repurchase-v1.1.json 发起原生 declare-use 并验证第二轮写入。',
  }), 202);
  const stateB2 = await waitIdle(host, projAud.id, taskB.id, stateB.snapshot.messages.length + 2);
  assert.equal(turn2WriteOk, true, 'Turn 2 authorized report write MUST succeed without protected_executor_draining!');
  assert.equal(fs.existsSync(path.join(projAud.rootPath, '060_reports', 'repurchase-v1.1-turn2-note.json')), true, 'Turn 2 report file MUST be persisted cleanly!');

  const packAfterTaskB2 = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}`));
  const useBRecord = [...packAfterTaskB2.pack.useRecords].reverse().find((u: any) => u.taskId === taskB.id && u.authorDeclaration);
  assert.ok(useBRecord, 'Task B native declare-use MUST auto-create an Enterprise Pack useRecord!');
  assert.equal(useBRecord.actualReads.length, 2);
  assert.equal(useBRecord.independentVerification.status, 'pending', 'Author declare-use MUST remain pending until an independent verifier task assesses it!');

  // Bare independentConfirmed: true WITHOUT an independent verifier task's disk-verified Studio assessment MUST stay pending!
  const verifyBareBool = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}/uses/${useBRecord.id}/verify`, 'POST', {
    requestId: randomUUID(),
    verifierRole: '独立核算复核',
    expectedRef: refundV2Ref,
    independentConfirmed: true,
    verdictDetail: '缺少真实独立核验报告仅传布尔值反例',
  }));
  assert.equal(verifyBareBool.use.independentVerification.status, 'pending', 'Bare independentConfirmed without independent disk-verified Studio assessment MUST stay pending!');

  // Now run a SEPARATE GENUINE INDEPENDENT verifier task (taskVerifyV2) that reads v1.1 required dependencies + Task B target report + authorized CSV data, writes 060_reports/repurchase-v1.1-assess.json, and calls studio_assets assess-use!
  const taskBReportRef = {
    authority: 'task' as const,
    id: taskB.id,
    projectId: projAud.id,
    taskId: taskB.id,
    version: sha(reportV2Bytes),
    sha256: sha(reportV2Bytes),
    locator: '060_reports/repurchase-v1.1.json',
  };
  const { task: taskVerifyV2 } = await json(await host.request(`/api/projects/${projAud.id}/tasks`, 'POST', { name: '独立复核新版V1.1任务' }), 201);
  const assessV2Text = JSON.stringify({
    assessed: 'repurchase-v1.1.json',
    targetSha256: sha(reportV2Bytes),
    packVersion: '1.1',
    originalCutoffChecked: '2026-10-31',
    originalCaseId: origCase.id,
    originalCaseTitle: origCase.title,
    originalDecisionId: origDecisionId,
    originalDecisionRevision: 1,
    caseDecisionsPreserved: true,
    shouldChange: [{ itemId: 'C07', originalOrderId: 'O-73', refundDate: '2026-10-02', classification: 'mapping_correction', beforeValue: '计入复购', afterValue: '冲销排除' }],
    shouldRetain: [{ itemId: 'C13', originalOrderId: 'O-81', unchangedValue: '计入复购' }],
    c07Excluded: true,
    c13Retained: true,
    numerator: 2,
    denominator: 4,
  });
  let stepVV2 = 0;
  provider.setResponder(() => {
    stepVV2 += 1;
    if (stepVV2 === 1) {
      return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', systemId: system.id, payload: { ref: refundV2Ref } } }] };
    }
    if (stepVV2 === 2) {
      return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', systemId: system.id, payload: { ref: sapM2Ref } } }] };
    }
    if (stepVV2 === 3) {
      return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', systemId: system.id, payload: { ref: taskBReportRef } } }] };
    }
    if (stepVV2 === 4) {
      return hasOsSandbox
        ? { calls: [{ name: 'read', arguments: { path: 'starbridge_orders.csv' } }] }
        : { calls: [{ name: 'read_input', arguments: { filename: 'starbridge_orders.csv' } }] };
    }
    if (stepVV2 === 5) {
      return hasOsSandbox
        ? { calls: [{ name: 'write', arguments: { path: '../060_reports/repurchase-v1.1-assess.json', content: assessV2Text } }] }
        : { calls: [{ name: 'write_report', arguments: { filename: 'repurchase-v1.1-assess.json', content: assessV2Text } }] };
    }
    if (stepVV2 === 6) {
      const assessSha = sha(assessV2Text);
      return {
        calls: [{
          name: 'studio_assets',
          arguments: {
            action: 'assess-use',
            systemId: system.id,
            payload: {
              useId: taskBStudioUseId,
              status: 'pass',
              report: {
                authority: 'task',
                id: taskVerifyV2.id,
                projectId: projAud.id,
                taskId: taskVerifyV2.id,
                version: assessSha,
                sha256: assessSha,
                locator: '060_reports/repurchase-v1.1-assess.json',
              },
              sources: [refundV2Ref, sapM2Ref],
              result: '独立复核任务 taskVerifyV2 实读 v1.1（refund v2 + sap 1.1.0）、目标报告 repurchase-v1.1.json 与原明细并核实 C07（O-73/2026-10-02）排除、C13（O-81）保留，分子分母 2/4 无误，原 Case 经营决定不变',
              evidence: {
                targetReport: taskBReportRef,
                coverage: { inputPaths: ['020_clean/starbridge_orders.csv'], scope: '星桥直营店9月首购队列，截至2026-10-31', detail: '已核对授权明细、观察窗和退款记录' },
                comparison: { metrics: [{ name: '分子', reported: 2, recomputed: 2 }, { name: '分母', reported: 4, recomputed: 4 }], facts: '按原单号核对退款变动和应保留的有效复购' },
              },
            },
          },
        }],
      };
    }
    return { text: '独立复核任务已完成对 v1.1 复算报告的独立实读与核验。' };
  });
  await json(await host.request(`/api/projects/${projAud.id}/tasks/${taskVerifyV2.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '请独立实读 v1.1 原依赖、Task B 原报告与明细后复核 Task B 的 v1.1 复算报告（核对 C07 应变、C13 保留与原 Case 决定不变）。',
  }), 202);
  await waitIdle(host, projAud.id, taskVerifyV2.id);

  const packAfterVV2 = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}`));
  const verifiedUseB = packAfterVV2.pack.useRecords.find((u: any) => u.id === useBRecord.id);
  assert.equal(verifiedUseB.independentVerification.status, 'pass', 'Independent verifier task assess-use MUST promote Task B useRecord to pass!');
  assert.equal(verifiedUseB.independentVerification.verifierTaskId, taskVerifyV2.id);
  assert.equal(verifiedUseB.independentVerification.verifierEvidenceSummary?.requiredAssetsCount, 2);
  assert.equal(verifiedUseB.independentVerification.verifierEvidenceSummary?.readRequiredAssetsCount, 2);
  assert.equal(verifiedUseB.independentVerification.verifierEvidenceSummary?.targetReportChecked, true);
  assert.equal(verifiedUseB.independentVerification.verifierEvidenceSummary?.authorizedInputChecked, true);
  assert.equal(verifiedUseB.independentVerification.verifierEvidenceSummary?.assessmentReportBoundToTarget, true);

  // R5 (Round-6/7): Closing feedback WITHOUT itemVerification, with bare itemId-only stub, with fabricated orderId NOT in 020_clean CSV, with mismatched cutoff, with missing/forged CaseRef, OR with wrong Case decisionRevision MUST ALL return 409!
  const closeNoItemEv = await ownerReq(`/api/studio/enterprise-packs/${packId}/feedback/${fb1.feedback.id}/handle`, 'POST', {
    requestId: randomUUID(),
    projectId: projBuild.id,
    status: 'verified',
    note: '缺少逐笔更正证据反例',
    revisedRef: refundV2Ref,
    revisedPackVersion: '1.1',
    verifiedByUseId: useBRecord.id,
  });
  assert.equal(closeNoItemEv.status, 409);

  // Bare itemId-only stub WITHOUT originalOrderId / refundDate MUST return 409!
  const closeBareIdOnly = await ownerReq(`/api/studio/enterprise-packs/${packId}/feedback/${fb1.feedback.id}/handle`, 'POST', {
    requestId: randomUUID(),
    projectId: projBuild.id,
    status: 'verified',
    note: '仅写编号未核对原单号/退款日反例',
    revisedRef: refundV2Ref,
    revisedPackVersion: '1.1',
    verifiedByUseId: useBRecord.id,
    itemVerification: {
      originalCutoffChecked: '2026-10-31',
      transactionAssociationNote: '仅有编号',
      shouldChange: [{ itemId: 'C07', beforeValue: '3/4', afterValue: '2/4' }],
      shouldRetain: [{ itemId: 'C13', unchangedValue: '保留' }],
      originalCaseRef: { caseId: origCase.id, decisionId: origDecisionId, decisionRevision: 1 },
      caseDecisionsPreserved: true,
    },
  });
  assert.equal(closeBareIdOnly.status, 409, 'Bare itemId-only itemVerification without originalOrderId/refundDate MUST be rejected!');

  // R5 (Round-7): Fabricated originalOrderId ('O-13' instead of REAL 'O-81' in 020_clean/starbridge_orders.csv!) MUST be rejected!
  const closeFabricatedOrder = await ownerReq(`/api/studio/enterprise-packs/${packId}/feedback/${fb1.feedback.id}/handle`, 'POST', {
    requestId: randomUUID(),
    projectId: projBuild.id,
    status: 'verified',
    note: '虚构订单号与 020_clean 原交易不符反例',
    revisedRef: refundV2Ref,
    revisedPackVersion: '1.1',
    verifiedByUseId: useBRecord.id,
    itemVerification: {
      originalCutoffChecked: '2026-10-31',
      transactionAssociationNote: '虚构 O-13 反例',
      shouldChange: [{ itemId: 'C07', originalOrderId: 'O-73', refundDate: '2026-10-02', beforeValue: '3/4', afterValue: '2/4' }],
      shouldRetain: [{ itemId: 'C13', originalOrderId: 'O-13', unchangedValue: '保留' }],
      originalCaseRef: { caseId: origCase.id, decisionId: origDecisionId, decisionRevision: 1 },
      caseDecisionsPreserved: true,
    },
  });
  assert.equal(closeFabricatedOrder.status, 409, 'Fabricated orderId mismatching real 020_clean CSV MUST return 409!');

  // Mismatched originalCutoffChecked MUST return 409!
  const closeWrongCutoff = await ownerReq(`/api/studio/enterprise-packs/${packId}/feedback/${fb1.feedback.id}/handle`, 'POST', {
    requestId: randomUUID(),
    projectId: projBuild.id,
    status: 'verified',
    note: '错填截止日反例',
    revisedRef: refundV2Ref,
    revisedPackVersion: '1.1',
    verifiedByUseId: useBRecord.id,
    itemVerification: {
      originalCutoffChecked: '2026-09-30',
      transactionAssociationNote: '错填截止日',
      shouldChange: [{ itemId: 'C07', originalOrderId: 'O-73', refundDate: '2026-10-02', beforeValue: '3/4', afterValue: '2/4' }],
      shouldRetain: [{ itemId: 'C13', originalOrderId: 'O-81', unchangedValue: '保留' }],
      originalCaseRef: { caseId: origCase.id, decisionId: origDecisionId, decisionRevision: 1 },
      caseDecisionsPreserved: true,
    },
  });
  assert.equal(closeWrongCutoff.status, 409, 'Mismatched originalCutoffChecked MUST be rejected!');

  // Omitting originalCaseRef when feedback had linked originalCaseRef MUST return 409!
  const closeMissingCase = await ownerReq(`/api/studio/enterprise-packs/${packId}/feedback/${fb1.feedback.id}/handle`, 'POST', {
    requestId: randomUUID(),
    projectId: projBuild.id,
    status: 'verified',
    note: '遗漏原 Case 核查反例',
    revisedRef: refundV2Ref,
    revisedPackVersion: '1.1',
    verifiedByUseId: useBRecord.id,
    itemVerification: {
      originalCutoffChecked: '2026-10-31',
      transactionAssociationNote: '未提供原 Case',
      shouldChange: [{ itemId: 'C07', originalOrderId: 'O-73', refundDate: '2026-10-02', beforeValue: '3/4', afterValue: '2/4' }],
      shouldRetain: [{ itemId: 'C13', originalOrderId: 'O-81', unchangedValue: '保留' }],
      caseDecisionsPreserved: true,
    },
  });
  assert.equal(closeMissingCase.status, 409, 'Omitting originalCaseRef when feedback is linked to a Case MUST be rejected!');

  // Forged nonexistent Case ID MUST return 409!
  const closeForgedCase = await ownerReq(`/api/studio/enterprise-packs/${packId}/feedback/${fb1.feedback.id}/handle`, 'POST', {
    requestId: randomUUID(),
    projectId: projBuild.id,
    status: 'verified',
    note: '伪造不存在原 Case 反例',
    revisedRef: refundV2Ref,
    revisedPackVersion: '1.1',
    verifiedByUseId: useBRecord.id,
    itemVerification: {
      originalCutoffChecked: '2026-10-31',
      transactionAssociationNote: '伪造 Case',
      shouldChange: [{ itemId: 'C07', originalOrderId: 'O-73', refundDate: '2026-10-02', beforeValue: '3/4', afterValue: '2/4' }],
      shouldRetain: [{ itemId: 'C13', originalOrderId: 'O-81', unchangedValue: '保留' }],
      originalCaseRef: { caseId: randomUUID() },
      caseDecisionsPreserved: true,
    },
  });
  assert.equal(closeForgedCase.status, 409, 'Forged Case ID MUST be rejected!');

  // R5 (Round-7): Wrong Case decisionRevision (99 != pinned rev.1) MUST return 409!
  const closeWrongDecisionRev = await ownerReq(`/api/studio/enterprise-packs/${packId}/feedback/${fb1.feedback.id}/handle`, 'POST', {
    requestId: randomUUID(),
    projectId: projBuild.id,
    status: 'verified',
    note: '错填原 Case 决策版本号反例',
    revisedRef: refundV2Ref,
    revisedPackVersion: '1.1',
    verifiedByUseId: useBRecord.id,
    itemVerification: {
      originalCutoffChecked: '2026-10-31',
      transactionAssociationNote: '错填决策版本',
      shouldChange: [{ itemId: 'C07', originalOrderId: 'O-73', refundDate: '2026-10-02', beforeValue: '3/4', afterValue: '2/4' }],
      shouldRetain: [{ itemId: 'C13', originalOrderId: 'O-81', unchangedValue: '保留' }],
      originalCaseRef: { caseId: origCase.id, decisionId: origDecisionId, decisionRevision: 99 },
      caseDecisionsPreserved: true,
    },
  });
  assert.equal(closeWrongDecisionRev.status, 409, 'Wrong Case decisionRevision MUST return 409!');

  // R5 (Round-8): Split-row spoofing (mixing C07 from row 2 with C13's O-81 from row 3!) MUST be rejected with 409 under single-row conjunction!
  const closeSplitRow = await ownerReq(`/api/studio/enterprise-packs/${packId}/feedback/${fb1.feedback.id}/handle`, 'POST', {
    requestId: randomUUID(),
    projectId: projBuild.id,
    status: 'verified',
    note: '跨行拼接账号与原单号反例',
    revisedRef: refundV2Ref,
    revisedPackVersion: '1.1',
    verifiedByUseId: useBRecord.id,
    itemVerification: {
      originalCutoffChecked: '2026-10-31',
      transactionAssociationNote: '跨行拼接反例',
      shouldChange: [{ itemId: 'C07', originalOrderId: 'O-81', refundDate: '2026-10-02', beforeValue: '3/4', afterValue: '2/4' }],
      shouldRetain: [{ itemId: 'C13', originalOrderId: 'O-81', unchangedValue: '保留' }],
      originalCaseRef: { caseId: origCase.id, decisionId: origDecisionId, decisionRevision: 1 },
      caseDecisionsPreserved: true,
    },
  });
  assert.equal(closeSplitRow.status, 409, 'Cross-row split spoofing (C07 + O-81) MUST return 409 under single-row conjunction!');

  const unprovedFeedback = await json(await projectReq(projStar.id, `/api/studio/enterprise-packs/${packId}/feedback`, 'POST', {
    requestId: randomUUID(), problemKey: 'missing-original-custody', packVersion: '1.0',
    title: '旧表原始回执未取得', category: 'shared_refund_mapping', targetAssetRef: refundV1Ref,
    report: fb1.feedback.reports[0],
  }));
  assert.equal(unprovedFeedback.feedback.reports[0].sourceReads, undefined);
  assert.equal(unprovedFeedback.feedback.reports[0].adoptionBasis, 'clue_only_no_pack_read');
  const unprovedClosure = await ownerReq(`/api/studio/enterprise-packs/${packId}/feedback/${unprovedFeedback.feedback.id}/handle`, 'POST', {
    requestId: randomUUID(), projectId: projBuild.id, status: 'verified',
    note: '准确报告和新版复算不能替代原资料可见性',
    revisedRef: refundV2Ref, revisedPackVersion: '1.1', verifiedByUseId: useBRecord.id,
    itemVerification: {
      originalCutoffChecked: '2026-10-31', transactionAssociationNote: '检查原始来源',
      shouldChange: [{ itemId: 'C07', originalOrderId: 'O-73', refundDate: '2026-10-02', beforeValue: '计入复购', afterValue: '冲销排除' }],
      shouldRetain: [{ itemId: 'C13', originalOrderId: 'O-81', unchangedValue: '计入复购' }],
    },
  });
  assert.equal(unprovedClosure.status, 409);
  assert.match(await unprovedClosure.text(), /feedback_verification_original_snapshot_unavailable/);

  const originalLiveSource = path.join(projStar.rootPath, '020_clean', 'starbridge_orders.csv');
  const revisedLiveSource = path.join(projAud.rootPath, '020_clean', 'starbridge_orders.csv');
  fs.renameSync(originalLiveSource, originalLiveSource + '.offline');
  fs.renameSync(revisedLiveSource, revisedLiveSource + '.offline');

  // Now close with REAL source-transaction-corroborated itemVerification (C07 + O-73 + 2026-10-02 should-change, C13 + REAL O-81 should-retain, exact cutoff 2026-10-31, and pinned original Case decision rev.1)!
  const closedFb = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}/feedback/${fb1.feedback.id}/handle`, 'POST', {
    requestId: randomUUID(),
    projectId: projBuild.id,
    status: 'verified',
    note: '已由独立新任务按 v1.1 复算并通过独立实读核验、逐笔原单/退款日/截止日及原 Case 决策 rev.1 核查闭环',
    revisedRef: refundV2Ref,
    revisedPackVersion: '1.1',
    verifiedByUseId: useBRecord.id,
    itemVerification: {
      originalCutoffChecked: '2026-10-31',
      transactionAssociationNote: '核查 020_clean 原单 O-73 与 2026-10-02 退款单在原截止日 2026-10-31 前已可见，原规则漏连跨月退款；C13 原单 O-81 保留有效；修订后原 Case 经营决定 rev.1 保留不变',
      shouldChange: [{
        itemId: 'C07',
        originalOrderId: 'O-73',
        refundDate: '2026-10-02',
        classification: 'mapping_correction',
        beforeValue: '计入复购',
        afterValue: '冲销排除',
        evidenceLocator: '060_reports/repurchase-v1.1.json',
      }],
      shouldRetain: [{
        itemId: 'C13',
        originalOrderId: 'O-81',
        unchangedValue: '计入复购',
        evidenceLocator: '060_reports/repurchase-v1.1.json',
      }],
      originalCaseRef: { caseId: origCase.id, decisionId: origDecisionId, decisionRevision: 1, summary: origCase.title },
      caseDecisionsPreserved: true,
    },
  }));
  assert.equal(closedFb.feedback.status, 'verified');
  assert.equal(closedFb.feedback.revisionLink.itemVerification.shouldChange[0].sourceFileSha256, sha(starCsv));
  assert.equal(closedFb.feedback.revisionLink.itemVerification.shouldChange[0].originalSourceVisibleOn, '2026-10-03');
  assert.equal(closedFb.feedback.revisionLink.itemVerification.shouldChange[0].originalSourceRead.ref.taskId, taskA.id);
  assert.equal(closedFb.feedback.revisionLink.itemVerification.shouldChange[0].revisedSourceRead.ref.taskId, taskB.id);
  fs.renameSync(revisedLiveSource + '.offline', revisedLiveSource);

  assert.equal(closedFb.feedback.revisionLink.fromPackVersion, '1.0');
  assert.equal(closedFb.feedback.revisionLink.toPackVersion, '1.1');
  assert.equal(closedFb.feedback.revisionLink.authorityUpdates.length, 1);
  assert.equal(closedFb.feedback.revisionLink.itemVerification.shouldChange[0].itemId, 'C07');
  assert.equal(closedFb.feedback.revisionLink.itemVerification.shouldChange[0].originalOrderId, 'O-73');
  assert.match(closedFb.feedback.revisionLink.itemVerification.shouldChange[0].sourceFileLocator ?? '', /starbridge_orders\.csv$/);
  assert.match(closedFb.feedback.revisionLink.itemVerification.shouldChange[0].sourceFileSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(closedFb.feedback.revisionLink.itemVerification.shouldChange[0].sourceRowNumber, 2);
  assert.equal(closedFb.feedback.revisionLink.itemVerification.shouldChange[0].sourceFullRefund, true);
  assert.equal(closedFb.feedback.revisionLink.itemVerification.shouldRetain[0].itemId, 'C13');
  assert.equal(closedFb.feedback.revisionLink.itemVerification.shouldRetain[0].originalOrderId, 'O-81');
  assert.equal(closedFb.feedback.revisionLink.itemVerification.shouldRetain[0].sourceRowNumber, 3);
  assert.equal(closedFb.feedback.revisionLink.itemVerification.originalCaseRef?.caseId, origCase.id);
  assert.equal(closedFb.feedback.revisionLink.itemVerification.originalCaseRef?.decisionId, origDecisionId);
  assert.equal(closedFb.feedback.revisionLink.itemVerification.originalCaseRef?.decisionRevision, 1);

  // R5 (Round-7/8): Verify GET /feedback/:id/case-history still reads back exact historical decision rev.1 even after a newer rev.2 is appended!
  const dec2 = await seedCaseDecisionAndRestart({
    caseId: origCase.id,
    recordId: origDecisionId,
    expectedRevision: 1,
    title: '星桥十一月调整后复购决策 rev2',
    proposal: '按 v1.1 口径微调下月复购激励并完成12月复盘',
    projectId: projStar.id,
    taskId: taskA.id,
  });
  assert.equal(dec2.revision, 2);
  const caseHist = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}/feedback/${fb1.feedback.id}/case-history`));
  assert.equal(caseHist.historicalDecision?.revision, 1, 'Feedback case-history MUST read back exact historical decision rev.1!');
  assert.equal(caseHist.historicalDecision?.payload?.title, '星桥十月截止复购激励决策 rev1');
  assert.equal(caseHist.latestDecision?.revision, 2);
  await json(await host.request(`/api/cases/${origCase.id}/projects/${projStar.id}`, 'DELETE', {
    operationId: randomUUID(),
    expectedRevision: caseHist.caseRecord.revision,
  }));

  // R5 (Round-8): Retroactive feedback submitted from old reply originA AFTER Case moved rev.1 -> rev.2 MUST NOT mis-pin rev.2!
  // AND closing post-cutoff new-event refund (C21, O-88, 2026-11-05 under newCutoffChecked 2026-11-15) MUST reject reusing old useBRecord (which never read starCsvNov15!) and succeed ONLY with a fresh analysis + independent verifier task that genuinely read starCsvNov15!
  const starCsvNov15 = starCsv.replace('C21,2026-09-05,O-88,2026-09-24,,false,星桥直营店,2026-09-24,岚线,直营', 'C21,2026-09-05,O-88,2026-09-24,2026-11-05,true,星桥直营店,2026-11-06,岚线,直营');
  fs.writeFileSync(path.join(projAud.rootPath, '020_clean', 'starbridge_orders.csv'), starCsvNov15);
  const fbPostCutoff = await json(await projectReq(projStar.id, `/api/studio/enterprise-packs/${packId}/feedback`, 'POST', {
    requestId: randomUUID(), origin: originA, problemKey: 'post-cutoff-nov-refund-c21', title: '截止日后新发生退款 C21（2026-11-05）',
    category: 'shared_refund_mapping', evidenceNote: 'C21 原单 O-88 在原截止日 2026-10-31 之后于 2026-11-05 发生全额退款',
  }));
  // CRITICAL (R5 Round-8): originA happened BEFORE dec2, and dec1/dec2 both post-date originA -> MUST NEVER silently pin rev.2!
  assert.equal(fbPostCutoff.feedback.reports[0].originalCaseRef?.caseId, origCase.id);
  assert.equal(fbPostCutoff.feedback.reports[0].originalCaseRef?.decisionRevision, 1,
    'The exact original Case decision survives a later revision and project unlink');

  // A real read in a later turn of the same old verifier cannot retroactively attach to its assessment.
  let laterVerifierRead = '';
  provider.setResponder(context => {
    if (!context.recentToolResults.length) {
      return { calls: [{ name: 'read_input', arguments: { filename: 'starbridge_orders.csv' } }] };
    }
    laterVerifierRead = providerMessageText(context.recentToolResults.at(-1)!.content);
    return { text: '后续查读完成。' };
  });
  const verifierBeforeLateRead = await json(await host.request(`/api/projects/${projAud.id}/tasks/${taskVerifyV2.id}`));
  await json(await host.request(`/api/projects/${projAud.id}/tasks/${taskVerifyV2.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '请查阅 11 月新台账。',
  }), 202);
  await waitIdle(host, projAud.id, taskVerifyV2.id, verifierBeforeLateRead.snapshot.messages.length + 4);
  assert.match(laterVerifierRead, /C21.*2026-11-05/);

  // Reusing older useBRecord (which NEVER read starCsvNov15!) MUST be rejected with 409!
  const staleUsePostCutoff = await ownerReq(`/api/studio/enterprise-packs/${packId}/feedback/${fbPostCutoff.feedback.id}/handle`, 'POST', {
    requestId: randomUUID(),
    projectId: projBuild.id,
    status: 'verified',
    note: '试图复用未读 2026-11-15 新数据集的旧核验记录结案反例',
    revisedRef: refundV2Ref,
    revisedPackVersion: '1.1',
    verifiedByUseId: useBRecord.id,
    itemVerification: {
      originalCutoffChecked: '2026-10-31',
      newCutoffChecked: '2026-11-15',
      transactionAssociationNote: '复用旧核验反例',
      shouldChange: [],
      postCutoffNewEvents: [{ itemId: 'C21', originalOrderId: 'O-88', refundDate: '2026-11-05', classification: 'post_cutoff_new_event', beforeValue: '有效', afterValue: '新事件排除' }],
      shouldRetain: [{ itemId: 'C13', originalOrderId: 'O-81', unchangedValue: '保留' }],
      originalCaseRef: { caseId: origCase.id, decisionId: origDecisionId, decisionRevision: 1, summary: origCase.title },
      caseDecisionsPreserved: true,
    },
  });
  assert.equal(staleUsePostCutoff.status, 409, 'A newer input read cannot change what the old verifier assessed.');

  // Run fresh analysis taskC + fresh independent verifier taskVerifyC AFTER starCsvNov15 was written!
  const { task: taskC } = await json(await host.request(`/api/projects/${projAud.id}/tasks`, 'POST', { name: '新截止日2026-11-15复算任务C' }), 201);
  const reportV2Nov15Text = JSON.stringify({
    packVersion: '1.1',
    originalCutoffChecked: '2026-10-31',
    newCutoffChecked: '2026-11-15',
    numerator: 1,
    denominator: 4,
    accounts: ['C13'],
    transactions: [
      transaction('C07', 'O-73', '冲销排除'),
      transaction('C13', 'O-81', '计入复购'),
      transaction('C21', 'O-88', '冲销排除'),
    ],
    postCutoffNewEvents: [{ itemId: 'C21', originalOrderId: 'O-88', refundDate: '2026-11-05' }],
  });
  let stepC = 0;
  let taskCStudioUseId = '';
  provider.setResponder(context => {
    stepC += 1;
    if (stepC === 1) return { calls: [{ name: 'studio_assets', arguments: { action: 'catalog' } }] };
    if (stepC === 2) return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', payload: { ref: refundV2Ref } } }] };
    if (stepC === 3) return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', payload: { ref: sapM2Ref } } }] };
    if (stepC === 4) {
      return hasOsSandbox
        ? { calls: [{ name: 'read', arguments: { path: 'starbridge_orders.csv' } }] }
        : { calls: [{ name: 'read_input', arguments: { filename: 'starbridge_orders.csv' } }] };
    }
    if (stepC === 5) {
      return hasOsSandbox
        ? { calls: [{ name: 'write', arguments: { path: '../060_reports/repurchase-v1.1-nov15.json', content: reportV2Nov15Text } }] }
        : { calls: [{ name: 'write_report', arguments: { filename: 'repurchase-v1.1-nov15.json', content: reportV2Nov15Text } }] };
    }
    if (stepC === 6) {
      const repSha = sha(reportV2Nov15Text);
      return {
        calls: [{
          name: 'studio_assets',
          arguments: {
            action: 'declare-use',
            systemId: system.id,
            payload: {
              report: { authority: 'task', id: taskC.id, projectId: projAud.id, taskId: taskC.id, version: repSha, sha256: repSha, locator: '060_reports/repurchase-v1.1-nov15.json' },
              sources: [refundV2Ref, sapM2Ref],
              result: '新截止日 2026-11-15 复算：C21(O-88, 2026-11-05) 属截止日后新事件，C13(O-81) 保留，分子分母 1/4',
            },
          },
        }],
      };
    }
    const declRes = JSON.parse(providerMessageText(context.recentToolResults.at(-1)!.content));
    taskCStudioUseId = declRes?.use?.id ?? taskCStudioUseId;
    return { text: '已完成 2026-11-15 新截止日复算并提交 declare-use。' };
  });
  await json(await host.request(`/api/projects/${projAud.id}/tasks/${taskC.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '请按新截止日 2026-11-15 读取更新后的 starbridge_orders.csv 复算复购率并提交 declare-use。',
  }), 202);
  await waitIdle(host, projAud.id, taskC.id);
  assert.ok(taskCStudioUseId);

  const taskCReportRef = {
    authority: 'task' as const,
    id: taskC.id,
    projectId: projAud.id,
    taskId: taskC.id,
    version: sha(reportV2Nov15Text),
    sha256: sha(reportV2Nov15Text),
    locator: '060_reports/repurchase-v1.1-nov15.json',
  };
  const { task: taskVerifyC } = await json(await host.request(`/api/projects/${projAud.id}/tasks`, 'POST', { name: '新截止日独立核验任务C' }), 201);
  const assessV2Nov15Text = JSON.stringify({
    assessed: 'repurchase-v1.1-nov15.json',
    targetSha256: sha(reportV2Nov15Text),
    packVersion: '1.1',
    originalCutoffChecked: '2026-10-31',
    newCutoffChecked: '2026-11-15',
    originalCaseId: origCase.id,
    originalCaseTitle: origCase.title,
    originalDecisionId: origDecisionId,
    originalDecisionRevision: 1,
    caseDecisionsPreserved: true,
    postCutoffNewEvents: [{ itemId: 'C21', originalOrderId: 'O-88', refundDate: '2026-11-05', classification: 'post_cutoff_new_event', beforeValue: '计入复购', afterValue: '冲销排除' }],
    shouldRetain: [{ itemId: 'C13', originalOrderId: 'O-81', unchangedValue: '计入复购' }],
    numerator: 1,
    denominator: 4,
  });
  let stepVC = 0;
  provider.setResponder(() => {
    stepVC += 1;
    if (stepVC === 1) return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', systemId: system.id, payload: { ref: refundV2Ref } } }] };
    if (stepVC === 2) return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', systemId: system.id, payload: { ref: sapM2Ref } } }] };
    if (stepVC === 3) return { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', systemId: system.id, payload: { ref: taskCReportRef } } }] };
    if (stepVC === 4) {
      return hasOsSandbox
        ? { calls: [{ name: 'read', arguments: { path: 'starbridge_orders.csv' } }] }
        : { calls: [{ name: 'read_input', arguments: { filename: 'starbridge_orders.csv' } }] };
    }
    if (stepVC === 5) {
      return hasOsSandbox
        ? { calls: [{ name: 'write', arguments: { path: '../060_reports/repurchase-v1.1-nov15-assess.json', content: assessV2Nov15Text } }] }
        : { calls: [{ name: 'write_report', arguments: { filename: 'repurchase-v1.1-nov15-assess.json', content: assessV2Nov15Text } }] };
    }
    if (stepVC === 6) {
      const assessSha = sha(assessV2Nov15Text);
      return {
        calls: [{
          name: 'studio_assets',
          arguments: {
            action: 'assess-use',
            systemId: system.id,
            payload: {
              useId: taskCStudioUseId,
              status: 'pass',
              report: { authority: 'task', id: taskVerifyC.id, projectId: projAud.id, taskId: taskVerifyC.id, version: assessSha, sha256: assessSha, locator: '060_reports/repurchase-v1.1-nov15-assess.json' },
              sources: [refundV2Ref, sapM2Ref],
              result: '独立核验任务 taskVerifyC 实读 2026-11-15 新明细与目标报告 repurchase-v1.1-nov15.json，确认 C21(O-88/2026-11-05) 为截止日后新事件、C13(O-81) 保留，1/4 通过',
              evidence: {
                targetReport: taskCReportRef,
                coverage: { inputPaths: ['020_clean/starbridge_orders.csv'], scope: '星桥直营店9月首购队列，截至2026-11-15', detail: '已核对授权明细、观察窗和退款记录' },
                comparison: { metrics: [{ name: '分子', reported: 1, recomputed: 1 }, { name: '分母', reported: 4, recomputed: 4 }], facts: '按原单号核对退款变动和应保留的有效复购' },
              },
            },
          },
        }],
      };
    }
    return { text: '新截止日独立核验已完成。' };
  });
  await json(await host.request(`/api/projects/${projAud.id}/tasks/${taskVerifyC.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '请作为独立核验任务实读 v1.1 原依赖、taskC 目标报告与 2026-11-15 新明细后完成复核。',
  }), 202);
  await waitIdle(host, projAud.id, taskVerifyC.id);

  const packAfterVC = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}`));
  const useCRecord = [...packAfterVC.pack.useRecords].reverse().find((u: any) => u.taskId === taskC.id && u.independentVerification.status === 'pass');
  assert.ok(useCRecord, 'Fresh new-cutoff taskC MUST achieve genuine independentVerification=pass!');

  const closedPostCutoff = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}/feedback/${fbPostCutoff.feedback.id}/handle`, 'POST', {
    requestId: randomUUID(),
    projectId: projBuild.id,
    status: 'verified',
    note: '新截止日 2026-11-15 下经新独立复核实读更新后原表确认 C21（O-88，2026-11-05）属于原截止日 2026-10-31 后新发生退款并归类结案',
    revisedRef: refundV2Ref,
    revisedPackVersion: '1.1',
    verifiedByUseId: useCRecord.id,
    itemVerification: {
      originalCutoffChecked: '2026-10-31',
      newCutoffChecked: '2026-11-15',
      transactionAssociationNote: 'C21 原单 O-88 退款发生于 2026-11-05（晚于原截止日 2026-10-31，处于新截止日 2026-11-15 内），按 post_cutoff_new_event 结案且保留原 Case 决定 rev.1',
      shouldChange: [],
      postCutoffNewEvents: [{
        itemId: 'C21',
        originalOrderId: 'O-88',
        refundDate: '2026-11-05',
        classification: 'post_cutoff_new_event',
        beforeValue: '计入复购',
        afterValue: '冲销排除',
        evidenceLocator: '060_reports/repurchase-v1.1-nov15-assess.json',
      }],
      shouldRetain: [{
        itemId: 'C13',
        originalOrderId: 'O-81',
        unchangedValue: '计入复购',
        evidenceLocator: '060_reports/repurchase-v1.1-nov15-assess.json',
      }],
      originalCaseRef: { caseId: origCase.id, decisionId: origDecisionId, decisionRevision: 1, summary: origCase.title },
      caseDecisionsPreserved: true,
    },
  }));
  assert.equal(closedPostCutoff.feedback.status, 'verified', 'Legitimate post-cutoff new-event refund under newCutoffChecked with fresh new-cutoff verifier MUST close cleanly as verified!');
  assert.equal(closedPostCutoff.feedback.revisionLink.itemVerification.newCutoffChecked, '2026-11-15');
  assert.equal(closedPostCutoff.feedback.revisionLink.itemVerification.postCutoffNewEvents?.[0]?.itemId, 'C21');
  assert.equal(closedPostCutoff.feedback.revisionLink.itemVerification.postCutoffNewEvents?.[0]?.sourceRowNumber, 4);
  assert.equal(closedPostCutoff.feedback.revisionLink.itemVerification.postCutoffNewEvents?.[0]?.sourceFullRefund, true);
  assert.match(closedPostCutoff.feedback.revisionLink.itemVerification.postCutoffNewEvents?.[0]?.sourceFileSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(closedPostCutoff.feedback.revisionLink.itemVerification.originalCaseRef?.decisionRevision, 1);

  // Confirm Task A pin remained 1.0, Task B pin is 1.1, and Task A's historical report file is untouched!
  const finalPack = await json(await ownerReq(`/api/studio/enterprise-packs/${packId}`));
  assert.equal(finalPack.pack.taskPins.find((p: any) => p.taskId === taskA.id).packVersion, '1.0');
  assert.equal(finalPack.pack.taskPins.find((p: any) => p.taskId === taskB.id).packVersion, '1.1');
  assert.equal(sha(fs.readFileSync(reportV1Path)), sha(reportV1Bytes), 'Historical v1.0 report bytes MUST remain completely untouched!');

  // --- 2E. R6.1 REAL PI RUNTIME ROLLBACK CHECK: Relaunch Host with --disable-member-pack on SAME dataRoot/projectsRoot ---
  const savedDataRoot = host.dataRoot;
  const savedProjectsRoot = host.projectsRoot;
  await host.close();

  const roHost = await startTestHost({ dataRoot: savedDataRoot, projectsRoot: savedProjectsRoot, disableMemberPack: true });
  t.after(() => roHost.close());
  const { task: taskRollback } = await json(await roHost.request(`/api/projects/${projAud.id}/tasks`, 'POST', { name: '回退期新任务实测' }), 201);
  let stepRb = 0;
  let catalogRollbackText = '';
  provider.setResponder(context => {
    stepRb += 1;
    if (stepRb === 1) return { calls: [{ name: 'studio_assets', arguments: { action: 'catalog' } }] };
    catalogRollbackText = providerMessageText(context.recentToolResults.at(-1)!.content);
    return { text: '只读回退期间新任务未收到会员包用途或依赖。' };
  });
  await json(await roHost.request(`/api/projects/${projAud.id}/tasks/${taskRollback.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '查看目录中可用的企业会员包用途。',
  }), 202);
  const rollbackState = await waitIdle(roHost, projAud.id, taskRollback.id);
  assert.match(catalogRollbackText, /"readOnlyRollback":true/, 'Rollback mode MUST signal readOnlyRollback: true!');
  assert.match(catalogRollbackText, /"pinnedVersion":null/, 'Brand-new task in rollback mode MUST NOT pin a pack version!');
  assert.match(catalogRollbackText, /"purposes":\[\]/, 'Brand-new task in rollback mode MUST receive ZERO pack purposes/dependencies!');
  const rollbackInputs = path.join(savedDataRoot, 'member-pack-workspaces', projAud.id, taskRollback.id, '020_clean');
  assert.deepEqual(fs.readdirSync(rollbackInputs), [], 'Rollback creates a capability boundary without copying project files');
  assert.equal(rollbackState.snapshot.tools.includes('bash'), false);
  const rollbackSelection = await roHost.request(`/api/projects/${projMerch.id}`);
  const rollbackCookie = rollbackSelection.headers.get('set-cookie')?.split(';')[0];
  assert.ok(rollbackCookie);
  const rollbackDetail = await fetch(`${roHost.baseUrl}/api/projects/${projMerch.id}/files/content?path=020_clean%2Fstarbridge_orders.csv`, {
    headers: { ...roHost.headers, cookie: rollbackCookie },
  });
  assert.equal(rollbackDetail.status, 403, 'A definition-only project cannot borrow detail during rollback');
  const rollbackHistory = await json(await roHost.request(`/api/projects/${projStar.id}/tasks/${taskA.id}`));
  assert.ok(!JSON.stringify(rollbackHistory.snapshot.messages).includes('O-73'), 'Rollback cannot resurface previous wider native output');
  assert.equal(sha(fs.readFileSync(reportV1Path)), sha(reportV1Bytes), 'Rollback preserves the earlier report bytes');
});

test('R2 (Round-8) · Real Pi SDK 1.4.0 live in-flight wide+narrow grant coexistence expiry on the SAME 020_clean CSV immediately narrows active task view', { timeout: 90_000 }, async t => {
  const provider = await startToolProvider();
  t.after(() => provider.close());
  const host = await startLegacyTestHost();
  t.after(() => host.close());

  await json(await host.request('/api/configuration', 'PUT', {
    name: 'R8 Wide Narrow Synthetic',
    provider: 'openai-compatible',
    baseUrl: provider.baseUrl,
    model: 'synthetic-r8-wide-narrow',
    apiKey: 'synthetic-only',
  }));

  const ent = await json(await host.request('/api/studio/enterprises', 'POST', { requestId: randomUUID(), name: '织屿宽窄并存' }), 201);
  const enterpriseId = ent.id;
  const regResp = await host.request('/api/studio/operators/session', 'POST', {
    action: 'register',
    operatorId: 'ops-r8-live',
    displayName: '宽窄授权测试负责人',
    passcode: 'live-r8-2026',
  });
  let ownerCookie = (regResp.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  await json(regResp, 200);

  const buildResp = await fetch(host.baseUrl + '/api/projects', {
    method: 'POST',
    headers: { ...host.headers, cookie: ownerCookie },
    body: JSON.stringify({ name: 'R8 实时建设' }),
  });
  ownerCookie = (buildResp.headers.get('set-cookie') ?? '').split(';')[0] || ownerCookie;
  const { project: projBuild } = await json(buildResp, 201);
  const ownerReq = (route: string, method = 'GET', body?: unknown) =>
    fetch(host.baseUrl + route, {
      method,
      headers: { ...host.headers, cookie: ownerCookie },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  const { project: projConsumer } = await json(await host.request('/api/projects', 'POST', { name: 'R8 实时宽窄消费' }), 201);
  const hasOsSandbox = process.platform === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec');
  const { task } = await json(await host.request(`/api/projects/${projConsumer.id}/tasks`, 'POST', { name: '在途宽窄过期切换任务' }), 201);
  const legacyRoute = `/api/projects/${projConsumer.id}/tasks/${task.id}/automatic-verification`;
  const mixedPath = path.join(projConsumer.rootPath, '020_clean', 'mixed_orders.csv');
  if (hasOsSandbox) {
    fs.writeFileSync(mixedPath, 'account,first_order_date,store\nH01,2026-09-02,湖庭直营店\n');
    await json(await host.request(`${legacyRoute}/settings`, 'PUT', {
      expectedRevision: 0,
      settings: { enabled: true, question: '合成兼容核算', dataFiles: ['020_clean/mixed_orders.csv'], reportPath: '060_reports/legacy.md' },
    }));
  }
  for (const p of [projBuild, projConsumer]) {
    await json(await host.request('/api/studio/enterprise-associations', 'POST', { requestId: randomUUID(), kind: 'project', entityId: p.id, enterpriseId }));
  }

  const { system } = await json(await ownerReq('/api/studio/systems', 'POST', {
    requestId: randomUUID(), enterpriseId, name: 'R8 实时体系', projectId: projBuild.id, goal: '宽窄并存实时过期验证', topicTitle: '宽窄过期',
  }), 201);
  await json(await ownerReq('/api/studio/enterprise-packs', 'POST', {
    requestId: randomUUID(), enterpriseId, systemId: system.id, domain: 'member-operations', name: 'R8 实时包',
  }));
  const authToken = (await json(await ownerReq(`/api/studio/resource-grants/authority?enterpriseId=${enterpriseId}&projectId=${projBuild.id}`))).grantAuthority.authorityToken;

  const mixedCsv = [
    'account,first_order_date,store',
    'H01,2026-09-02,湖庭直营店',
    'S02,2026-09-03,杉岸直营店',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(projConsumer.rootPath, '020_clean', 'mixed_orders.csv'), mixedCsv);

  const openConsumer = await host.request(`/api/projects/${projConsumer.id}`);
  assert.equal(openConsumer.status, 200);
  const consumerCookie = (openConsumer.headers.get('set-cookie') ?? '').split(';')[0]!;
  const consumerReq = (route: string, method = 'GET', data?: unknown) =>
    fetch(host.baseUrl + route, {
      method,
      headers: { ...host.headers, cookie: consumerCookie },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  const inputVersionId = randomUUID(), datasetId = randomUUID();
  const dataContext = `/api/projects/${projConsumer.id}/data-context`;
  const frozenEvidence = `${dataContext}/datasets/${datasetId}/versions/${inputVersionId}/evidence`;

  // Grant TWO grants on the SAME 020_clean/mixed_orders.csv:
  // - Wide grant (湖庭直营店 + 杉岸直营店) expiring in 2500ms
  // - Narrow grant (湖庭直营店 ONLY) with NO expiry
  const wideExpiryIso = new Date(Date.now() + 12_000).toISOString();
  await json(await ownerReq('/api/studio/resource-grants', 'POST', {
    requestId: randomUUID(), enterpriseId, grantorProjectId: projBuild.id, authorityToken: authToken,
    grantBasis: '实时宽授权（两店短期）', subjectType: 'project', subjectId: projConsumer.id, resourceKind: 'detail',
    operations: ['read-detail-recalculate'],
    scope: { stores: ['湖庭直营店', '杉岸直营店'], allowedDataPaths: ['020_clean/mixed_orders.csv'] },
    validTo: wideExpiryIso,
  }));
  await json(await ownerReq('/api/studio/resource-grants', 'POST', {
    requestId: randomUUID(), enterpriseId, grantorProjectId: projBuild.id, authorityToken: authToken,
    grantBasis: '实时窄授权（湖庭长期）', subjectType: 'project', subjectId: projConsumer.id, resourceKind: 'detail',
    operations: ['read-detail-recalculate'],
    scope: { stores: ['湖庭直营店'], allowedDataPaths: ['020_clean/mixed_orders.csv'] },
  }));

  await json(await consumerReq(`${dataContext}/inputs`, 'POST', {
    datasetId, inputVersionId, operationId: inputVersionId, baseIndexRevision: 0, name: '冻结合成明细',
    sourcePath: '020_clean/mixed_orders.csv', expectedSha256: sha(mixedCsv), expectedBytes: Buffer.byteLength(mixedCsv),
  }), 201);
  const wideEvidence = await consumerReq(frozenEvidence);
  assert.equal(wideEvidence.status, 200);
  assert.equal(await wideEvidence.text(), mixedCsv);

  if (hasOsSandbox) {
    assert.equal((await json(await host.request(`${legacyRoute}/settings`))).settings.enabled, true);
    assert.equal((await json(await host.request(`${legacyRoute}/capabilities`))).supported, false);
  }

  // Turn 1 (BEFORE wide grant expiry): reads mixed_orders.csv -> sees BOTH H01 and S02!
  let step1 = 0;
  let turn1CsvText = '';
  provider.setResponder(context => {
    step1 += 1;
    if (step1 === 1) {
      return hasOsSandbox
        ? { calls: [{ name: 'read', arguments: { path: 'mixed_orders.csv' } }] }
        : { calls: [{ name: 'read_input', arguments: { filename: 'mixed_orders.csv' } }] };
    }
    turn1CsvText = providerMessageText(context.recentToolResults.at(-1)!.content);
    return { text: '第1轮已读取宽授权期间明细。' };
  });
  await json(await host.request(`/api/projects/${projConsumer.id}/tasks/${task.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '第1轮读取 mixed_orders.csv。',
  }), 202);
  const st1 = await waitIdle(host, projConsumer.id, task.id);
  assert.ok(turn1CsvText.includes('H01') && turn1CsvText.includes('S02'), `Turn 1 before wide expiry MUST see both H01 and S02, got: ${turn1CsvText}`);

  // Wait until wide grant has naturally expired (narrow grant remains active on the SAME path!)
  const waitMs = Math.max(0, Date.parse(wideExpiryIso) - Date.now()) + 250;
  await new Promise(resolve => setTimeout(resolve, waitMs));

  // Turn 2 (SAME in-flight task AFTER wide grant expiry): reads mixed_orders.csv -> MUST IMMEDIATELY drop S02 and retain ONLY H01!
  let step2 = 0;
  let turn2CsvText = '';
  provider.setResponder(context => {
    step2 += 1;
    if (step2 === 1) {
      assert.ok(!JSON.stringify(context.messages).includes('S02'), 'A resumed narrow run must not resend the wider native context to its provider');
      return hasOsSandbox
        ? { calls: [{ name: 'read', arguments: { path: 'mixed_orders.csv' } }] }
        : { calls: [{ name: 'read_input', arguments: { filename: 'mixed_orders.csv' } }] };
    }
    turn2CsvText = providerMessageText(context.recentToolResults.at(-1)!.content);
    return { text: '第2轮宽授权到期后仅读取到湖庭窄授权明细。' };
  });
  await json(await host.request(`/api/projects/${projConsumer.id}/tasks/${task.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '第2轮继续读取 mixed_orders.csv。',
  }), 202);
  await waitIdle(host, projConsumer.id, task.id, st1.snapshot.messages.length + 2);
  assert.ok(turn2CsvText.includes('H01'), `Turn 2 after wide expiry MUST still see narrow-granted H01, got: ${turn2CsvText}`);
  assert.ok(!turn2CsvText.includes('S02') && !turn2CsvText.includes('杉岸直营店'), `Turn 2 after wide expiry MUST immediately strip expired wide-grant store S02, got: ${turn2CsvText}`);
  const visibleTaskAfterExpiry = await json(await consumerReq(`/api/projects/${projConsumer.id}/tasks/${task.id}`));
  assert.ok(!JSON.stringify(visibleTaskAfterExpiry.snapshot.messages).includes('S02'), 'The browser history suppresses content from the earlier wider permission');
  assert.ok(JSON.stringify(visibleTaskAfterExpiry.snapshot.messages).includes('H01'), 'The browser still displays the latest authorized history');
  const narrowEvidence = await consumerReq(frozenEvidence);
  assert.equal(narrowEvidence.status, 403, 'A frozen immutable snapshot requiring a wider grant stays withheld');
  const currentObserved = await json(await consumerReq(`${dataContext}/preview`, 'POST', { path: '020_clean/mixed_orders.csv' }));
  const narrowVersion = randomUUID();
  await json(await consumerReq(`${dataContext}/inputs`, 'POST', {
    datasetId, inputVersionId: narrowVersion, operationId: narrowVersion, baseIndexRevision: 1, name: '冻结合成明细',
    sourcePath: '020_clean/mixed_orders.csv', expectedSha256: currentObserved.sha256, expectedBytes: currentObserved.bytes,
  }), 201);
  const newEvidence = await consumerReq(`${dataContext}/datasets/${datasetId}/versions/${narrowVersion}/evidence`);
  assert.equal(newEvidence.status, 200, 'The borrower can freeze and retrieve exactly the current authorized view');
  assert.equal(await newEvidence.text(), 'account,first_order_date,store\nH01,2026-09-02,湖庭直营店\n');
  const visibleDataContext = await json(await consumerReq(dataContext));
  assert.equal(visibleDataContext.index.revision, 2);
  assert.deepEqual(visibleDataContext.datasets[0].versions.map((record: any) => record.inputVersionId), [narrowVersion]);
  assert.deepEqual(visibleDataContext.index.datasets[0].versions.map((record: any) => record.inputVersionId), [narrowVersion]);
  const semantic = await json(await consumerReq(`/api/projects/${projConsumer.id}/tasks/${task.id}/semantic-context`, 'POST', {
    action: 'read', target: { kind: 'data-input', projectId: projConsumer.id, datasetId, inputVersionId },
  }));
  assert.ok(!JSON.stringify(semantic).includes('S02'), 'The semantic reader applies the same frozen original authorization');

  const expiry = new Date(Date.now() + 12_000).toISOString();
  await json(await ownerReq('/api/studio/resource-grants', 'POST', {
    requestId: randomUUID(), enterpriseId, grantorProjectId: projBuild.id, authorityToken: authToken,
    grantBasis: '在途合成明细权限', subjectType: 'project', subjectId: projConsumer.id, resourceKind: 'detail',
    operations: ['read-detail-recalculate'], validTo: expiry,
    scope: { stores: ['湖庭直营店', '杉岸直营店'], allowedDataPaths: ['020_clean/mixed_orders.csv'] },
  }));
  const { task: duringExpiry } = await json(await host.request(`/api/projects/${projConsumer.id}/tasks`, 'POST', { name: '权限到期中的活动任务' }), 201);
  const providerCount = provider.requests.length;
  let expiryStep = 0;
  provider.setResponder(() => {
    if (++expiryStep === 1 && hasOsSandbox) return { calls: [
      { name: 'write', arguments: { path: '../060_reports/held.md', content: '合成暂存稿' } },
    ] };
    return { hold: true };
  });
  await json(await host.request(`/api/projects/${projConsumer.id}/tasks/${duringExpiry.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '保存一份暂存稿后继续等待。',
  }), 202);
  const heldIndex = providerCount + (hasOsSandbox ? 1 : 0);
  await provider.waitForRequests(heldIndex + 1);
  const held = provider.requests[heldIndex]!;
  for (let attempt = 0; attempt < 140 && !held.closedEarly; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(held.closedEarly, true, 'Natural expiry retires an already admitted active operation');
  assert.equal(fs.existsSync(path.join(projConsumer.rootPath, '060_reports', 'held.md')), false, 'A late staged report is never published after retirement');
  assert.deepEqual(provider.errors, []);
});
