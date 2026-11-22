import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';

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
    const state = await json(await host.request(route));
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
  const { project: projBuild } = await json(await host.request('/api/projects', 'POST', { name: '会员资产建设' }), 201);
  await json(await host.request('/api/studio/enterprise-associations', 'POST', { requestId: randomUUID(), kind: 'project', entityId: projBuild.id, enterpriseId }));

  // Place 3 enterprise materials (制度、月报、字段表) into construction project's 020_clean/
  const policyText = '# 织屿会员制度\n单品牌会员账号口径，首购后30日内有效再购计复购，全额退款不计入有效购买。\n';
  const reportText = '# 2026年9月直营月报\n星桥直营店9月首购队列观察窗30天，跨店直营再购归首购门店。\n';
  const schemaText = 'field,desc\naccount,会员账号\norder_id,订单号\norder_date,下单日\nrefund_date,退款日\nfull_refund,是否全额退款\nstore,门店\n';
  fs.writeFileSync(path.join(projBuild.rootPath, '020_clean', 'member_policy.md'), policyText);
  fs.writeFileSync(path.join(projBuild.rootPath, '020_clean', 'monthly_report.md'), reportText);
  fs.writeFileSync(path.join(projBuild.rootPath, '020_clean', 'order_fields.csv'), schemaText);

  const { system } = await json(await host.request('/api/studio/systems', 'POST', {
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
  const listed = await json(await host.request(`/api/studio/enterprise-packs?enterpriseId=${enterpriseId}&domain=member-operations`));
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

test('R1/R2/R4/R5 · Real Pi SDK 1.4.0 enforces default-deny, live Pi native read/bash narrowing, directory-only feedback separation & taskCutoff preservation, exact version read + report verification, authority revision v1.0->v1.1, and independent Python recalculation (C07 changes, C13 stays)', { timeout: 120_000 }, async t => {
  const provider = await startToolProvider();
  t.after(() => provider.close());
  const host = await startTestHost();
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

  const { project: projBuild } = await json(await host.request('/api/projects', 'POST', { name: '会员建设' }), 201);
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
    'account,first_order_date,repeat_order_id,repeat_order_date,refund_date,full_refund,store',
    'C07,2026-09-02,O-73,2026-09-18,2026-10-02,true,星桥直营店',
    'C13,2026-09-03,O-81,2026-09-20,,false,星桥直营店',
    'C21,2026-09-05,O-88,2026-09-24,,false,星桥直营店',
    'C30,2026-09-06,,,,false,星桥直营店',
    '',
  ].join('\n');
  const willowCsv = 'account,first_order_date,repeat_order_id,repeat_order_date,refund_date,full_refund,store\nW01,2026-09-04,O-99,2026-09-19,,false,柳岸直营店\n';
  for (const p of [projMerch, projStar, projAud]) {
    fs.writeFileSync(path.join(p.rootPath, '020_clean', 'starbridge_orders.csv'), starCsv);
    fs.writeFileSync(path.join(p.rootPath, '020_clean', 'willowbank_orders.csv'), willowCsv);
  }

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
  const { system } = await json(await host.request('/api/studio/systems', 'POST', {
    requestId: randomUUID(), enterpriseId, name: '织屿会员体系', projectId: projBuild.id, goal: '会员运营资产包', topicTitle: '门店复购',
  }), 201);
  const { pack } = await json(await host.request('/api/studio/enterprise-packs', 'POST', {
    requestId: randomUUID(), enterpriseId, systemId: system.id, domain: 'member-operations', name: '织屿会员运营包',
  }));
  const packId = pack.id;

  const { purpose } = await json(await host.request(`/api/studio/enterprise-packs/${packId}/purposes`, 'POST', {
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

  const { preview: prev1 } = await json(await host.request(`/api/studio/enterprise-packs/${packId}/previews`, 'POST', {
    requestId: randomUUID(), projectId: projBuild.id, version: '1.0', purposeIds: [purpose.id],
    policyEffectiveFrom: '2026-09-01', dataCutoffAt: '2026-10-31', summary: '首版发布 v1.0',
  }));
  const conf1 = await json(await host.request(`/api/studio/enterprise-packs/${packId}/confirm`, 'POST', {
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

  // --- 2B. Directory-only task (projMerch, read-definition only) with task cutoff 2026-10-27 vs pack 2026-10-31 ---
  await json(await host.request('/api/studio/resource-grants', 'POST', {
    requestId: randomUUID(), enterpriseId, grantorProjectId: projBuild.id, grantBasis: '商品部仅查定义，禁读明细',
    subjectType: 'project', subjectId: projMerch.id, resourceKind: 'definition',
    purposeKeys: ['store-first-purchase-30d-repurchase'], operations: ['read-definition'],
    scope: { brand: '岚线', channel: '直营' },
  }));

  const { task: taskD } = await json(await host.request(`/api/projects/${projMerch.id}/tasks`, 'POST', { name: '商品部仅看目录反例' }), 201);
  let stepD = 0;
  let merchNativeReadBlocked = false;
  provider.setResponder(context => {
    stepD += 1;
    if (stepD === 1) return { calls: [{ name: 'studio_assets', arguments: { action: 'catalog' } }] };
    if (stepD === 2) {
      // Attempt Pi native `read` tool on existing starbridge_orders.csv (sandbox 020_clean is empty + guard blocks!)
      return { calls: [{ name: 'read', arguments: { path: 'starbridge_orders.csv' } }] };
    }
    const readResText = providerMessageText(context.recentToolResults.at(-1)!.content);
    merchNativeReadBlocked = readResText.includes('detail_access_not_authorized') || readResText.includes('禁止读取项目 020_clean');
    return { text: '仅查看了目录，未读取任何原资产，且无权读取明细文件。' };
  });
  await json(await host.request(`/api/projects/${projMerch.id}/tasks/${taskD.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '请按数据截止 2026-10-27 查阅门店复购目录。',
  }), 202);
  const stateD = await waitIdle(host, projMerch.id, taskD.id);
  assert.equal(merchNativeReadBlocked, true, 'Definition-only project MUST be blocked from Pi native read on 020_clean CSV!');

  const assistantMsgD = [...stateD.snapshot.messages].reverse().find((m: any) => m.role === 'assistant' && m.nativeEntryId && m.nativeSessionId);
  assert.ok(assistantMsgD);
  const fbDirOnly = await json(await host.request(`/api/studio/enterprise-packs/${packId}/feedback`, 'POST', {
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
  const fbUnrelated = await json(await host.request(`/api/studio/enterprise-packs/${packId}/feedback`, 'POST', {
    requestId: randomUUID(),
    origin: { projectId: projMerch.id, taskId: taskD.id, sessionId: assistantMsgD2.nativeSessionId, messageId: assistantMsgD2.nativeEntryId },
    problemKey: 'unrelated-read-counterexample',
    title: '读取无关材料反例反馈',
    category: 'member_policy',
    evidenceNote: '本轮仅读了无关行政公告',
  }));
  assert.notEqual(fbUnrelated.feedback.reports[0].adoptionBasis, 'verified_actual_read', 'Reading an unrelated material MUST NOT be marked verified_actual_read!');
  assert.equal(fbUnrelated.feedback.reports[0].usedPackVersion, undefined);

  // --- 2C. Authorized Starbridge task: isolated sandbox + subagent lockout + catalog -> read-source BOTH pinned refs -> Python calc -> 060_reports sync -> Turn 2 zero-tool isolation -> live revocation purge ---
  const starGrantCreated = await json(await host.request('/api/studio/resource-grants', 'POST', {
    requestId: randomUUID(), enterpriseId, grantorProjectId: projBuild.id, grantBasis: '星桥店长仅读本店明细',
    subjectType: 'project', subjectId: projStar.id, resourceKind: 'detail',
    purposeKeys: ['store-first-purchase-30d-repurchase'], operations: ['read-definition', 'read-detail-recalculate'],
    scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店'], allowedDataPaths: ['020_clean/starbridge_orders.csv'] },
  }));
  const starGrantId = starGrantCreated.grant.id;

  const { task: taskA } = await json(await host.request(`/api/projects/${projStar.id}/tasks`, 'POST', { name: '星桥首版复购分析' }), 201);
  let stepA = 0;
  let starAllowed = false;
  let willowInputBlocked = false;
  let willowNativeReadBlocked = false;
  let willowNativeBashBlocked = false;
  let physicalIsolationProof = '';
  let taskACatalogText = '';
  let refundV1ReadText = '';
  let sapM1ReadText = '';

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
      return { calls: [{ name: 'read_input', arguments: { filename: 'starbridge_orders.csv' } }] };
    }
    if (stepA === 5) {
      const starText = providerMessageText(context.recentToolResults.at(-1)!.content);
      starAllowed = starText.includes('C07') && starText.includes('C13');
      return { calls: [{ name: 'read_input', arguments: { filename: 'willowbank_orders.csv' } }] };
    }
    if (stepA === 6) {
      const txt = providerMessageText(context.recentToolResults.at(-1)!.content);
      willowInputBlocked = txt.includes('detail_data_path_not_authorized') || txt.includes('resource_detail_not_authorized');
      return { calls: [{ name: 'read', arguments: { path: 'willowbank_orders.csv' } }] };
    }
    if (stepA === 7) {
      const res = context.recentToolResults.at(-1)!;
      willowNativeReadBlocked = providerMessageText(res.content).includes('store_detail_not_authorized');
      return { calls: [{ name: 'bash', arguments: { command: 'cat willowbank_orders.csv' } }] };
    }
    if (stepA === 8) {
      const res = context.recentToolResults.at(-1)!;
      willowNativeBashBlocked = providerMessageText(res.content).includes('store_detail_not_authorized');
      // R2.4 Physical workspace isolation check: verify starbridge_orders.csv exists in sandbox cwd and compute ../060_reports/repurchase-v1.0.json
      const pyCmd = `python3 -c "import csv, json, os; print('ISO_CWD=' + os.getcwd() + '|STAR=' + str(os.path.exists('starbridge_orders.csv'))); rows = list(csv.DictReader(open('starbridge_orders.csv'))); rep = [r['account'] for r in rows if r['repeat_order_id'] and not (r['full_refund']=='true' and r['refund_date'].startswith('2026-09'))]; open('../060_reports/repurchase-v1.0.json','w').write(json.dumps({'packVersion':'1.0','numerator':len(rep),'denominator':len(rows),'accounts':rep}, ensure_ascii=False))"`;
      return { calls: [{ name: 'bash', arguments: { command: pyCmd } }] };
    }
    physicalIsolationProof = providerMessageText(context.recentToolResults.at(-1)!.content);
    return { text: '星桥9月首购队列按v1.0（已查读销售退款映射v1及复购指标1.0.0）核得 3/4（C07、C13、C21），结果已保存至 060_reports/repurchase-v1.0.json；柳岸明细未授权，未当作零。' };
  });

  await json(await host.request(`/api/projects/${projStar.id}/tasks/${taskA.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '请按星桥直营店授权资料核查 9 月门店复购（数据截止 2026-10-31）。',
  }), 202);
  const stateA = await waitIdle(host, projStar.id, taskA.id);
  assert.equal(starAllowed, true);
  assert.equal(willowInputBlocked, true);
  assert.equal(willowNativeReadBlocked, true, 'Pi native read on unauthorized willowbank_orders.csv MUST be blocked!');
  assert.equal(willowNativeBashBlocked, true, 'Pi native bash referencing unauthorized willowbank_orders.csv MUST be blocked!');
  assert.match(physicalIsolationProof, /member-pack-workspaces/, 'Restricted task MUST run inside task-isolated workspace sandbox!');
  assert.match(physicalIsolationProof, /STAR=True/, 'Authorized file MUST exist in restricted task sandbox!');
  const sandboxCleanDir = path.join(host.dataRoot, 'member-pack-workspaces', projStar.id, taskA.id, '020_clean');
  assert.equal(fs.existsSync(path.join(sandboxCleanDir, 'starbridge_orders.csv')), true);
  assert.equal(fs.existsSync(path.join(sandboxCleanDir, 'willowbank_orders.csv')), false, 'Unauthorized willowbank_orders.csv MUST NOT physically exist in restricted task sandbox!');
  // R2.4: Subagent & connector tools MUST be disabled in restricted member-pack sessions!
  assert.equal((stateA.snapshot.tools ?? []).includes('subagent'), false, 'Restricted member-pack session MUST disable subagent delegation!');
  assert.match(taskACatalogText, /"pinnedVersion":"1\.0"/);
  assert.match(taskACatalogText, /"dependencies":\[/);
  assert.match(refundV1ReadText, /v1口径：仅扣除与再购单同月的全额退款/);
  assert.match(sapM1ReadText, /membership-repurchase/);
  assert.deepEqual(provider.errors, []);

  // Verify 060_reports/repurchase-v1.0.json synced from restricted sandbox into projStar/060_reports!
  const reportV1Path = path.join(projStar.rootPath, '060_reports', 'repurchase-v1.0.json');
  const reportV1Bytes = fs.readFileSync(reportV1Path);
  const reportV1Json = JSON.parse(reportV1Bytes.toString('utf8'));
  assert.equal(reportV1Json.numerator, 3);
  assert.equal(reportV1Json.denominator, 4);
  assert.ok(reportV1Json.accounts.includes('C07'));
  assert.ok(reportV1Json.accounts.includes('C13'));

  const assistantMsgA = [...stateA.snapshot.messages].reverse().find((m: any) => m.role === 'assistant' && m.nativeEntryId && m.nativeSessionId);
  assert.ok(assistantMsgA);
  const useA = await json(await host.request(`/api/studio/enterprise-packs/${packId}/uses`, 'POST', {
    requestId: randomUUID(),
    projectId: projStar.id,
    taskId: taskA.id,
    sessionId: assistantMsgA.nativeSessionId,
    messageId: assistantMsgA.nativeEntryId,
    purposeId: purpose.id,
    accessLevel: 'recalculate',
    authorDeclaration: {
      declaredPurposeId: purpose.id,
      declaredRefs: [refundV1Ref, sapM1Ref],
      summaryText: 'Task A 作者采用声明：按 v1.0 核得星桥 3/4',
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
  assert.equal(useA.use.actualReads.length, 2, 'Host MUST extract BOTH real native read-source receipts from Task A Turn 1!');
  assert.equal(useA.use.reportRef.sha256, sha(reportV1Bytes));
  const verifiedUseA = await json(await host.request(`/api/studio/enterprise-packs/${packId}/uses/${useA.use.id}/verify`, 'POST', {
    requestId: randomUUID(),
    verifierRole: '独立复核',
    expectedRef: refundV1Ref,
    independentConfirmed: true,
    verdictDetail: 'Task A v1.0 复核通过',
  }));
  assert.equal(verifiedUseA.use.independentVerification.status, 'pass');

  // R4.1 COUNTEREXAMPLE: Send Turn 2 on Task A with ZERO tool calls -> feedback from Turn 2 MUST NOT inherit Turn 1 reads!
  provider.setResponder(() => ({ text: '本轮未调用任何工具，仅做纯文字补充讨论。' }));
  await json(await host.request(`/api/projects/${projStar.id}/tasks/${taskA.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '不用查工具，简单总结一下刚才的思路。',
  }), 202);
  const stateATurn2 = await waitIdle(host, projStar.id, taskA.id, stateA.snapshot.messages.length + 2);
  const assistantMsgATurn2 = [...stateATurn2.snapshot.messages].reverse().find((m: any) => m.role === 'assistant' && m.nativeEntryId && m.nativeSessionId);
  assert.ok(assistantMsgATurn2 && assistantMsgATurn2.nativeEntryId !== assistantMsgA.nativeEntryId);
  const fbZeroToolTurn = await json(await host.request(`/api/studio/enterprise-packs/${packId}/feedback`, 'POST', {
    requestId: randomUUID(),
    origin: { projectId: projStar.id, taskId: taskA.id, sessionId: assistantMsgATurn2.nativeSessionId, messageId: assistantMsgATurn2.nativeEntryId },
    problemKey: 'zero-tool-turn-isolation',
    title: '无工具调用轮次不继承前轮实读反例',
    category: 'member_policy',
    evidenceNote: '本轮无任何工具调用',
  }));
  assert.notEqual(fbZeroToolTurn.feedback.reports[0].adoptionBasis, 'verified_actual_read', 'Tool-free Turn 2 MUST NEVER inherit Turn 1 actualReads!');
  assert.equal(fbZeroToolTurn.feedback.reports[0].usedPackVersion, undefined);
  assert.deepEqual(fbZeroToolTurn.feedback.reports[0].usedAssetRefs, []);

  // Submit feedback from Task A's Turn 1 native reply twice -> verified_actual_read + usedPackVersion='1.0' + dedupe!
  const originA = { projectId: projStar.id, taskId: taskA.id, sessionId: assistantMsgA.nativeSessionId, messageId: assistantMsgA.nativeEntryId };
  const fb1 = await json(await host.request(`/api/studio/enterprise-packs/${packId}/feedback`, 'POST', {
    requestId: randomUUID(), origin: originA, problemKey: 'cross-month-refund', title: '跨月全额退款漏连原单',
    category: 'shared_refund_mapping', evidenceNote: '账号 C07 10月2日全额退款未冲销9月再购 O-73',
  }));
  const fb2 = await json(await host.request(`/api/studio/enterprise-packs/${packId}/feedback`, 'POST', {
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
  assert.equal(fb1.feedback.targetAssetRef.id, refundV1Ref.id);

  // R5.3 COUNTEREXAMPLE: Attempting to close fb1 using Task A's OWN v1.0 pass use record MUST be rejected (409)!
  const badSameTaskClose = await host.request(`/api/studio/enterprise-packs/${packId}/feedback/${fb1.feedback.id}/handle`, 'POST', {
    requestId: randomUUID(),
    projectId: projBuild.id,
    status: 'verified',
    note: '试图用同任务同旧版假闭环',
    verifiedByUseId: useA.use.id,
  });
  assert.equal(badSameTaskClose.status, 409, 'Same task / same old version MUST NOT be allowed to close feedback as verified!');

  // Route feedback to original authority (creates real linked Studio workItem & feedback!)
  const routed = await json(await host.request(`/api/studio/enterprise-packs/${packId}/feedback/${fb1.feedback.id}/handle`, 'POST', {
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

  await json(await host.request(`/api/studio/enterprise-packs/${packId}/purposes`, 'POST', {
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
  const { preview: prev2 } = await json(await host.request(`/api/studio/enterprise-packs/${packId}/previews`, 'POST', {
    requestId: randomUUID(), projectId: projBuild.id, version: '1.1', previousVersion: '1.0', purposeIds: [purpose.id],
    policyEffectiveFrom: '2026-09-01', dataCutoffAt: '2026-10-31', summary: '跨月退款修订 v1.1',
  }));
  const conf2 = await json(await host.request(`/api/studio/enterprise-packs/${packId}/confirm`, 'POST', {
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

  // R2.4 LIVE REVOCATION PURGE: Revoke projStar's grant mid-session -> verify starbridge_orders.csv is IMMEDIATELY purged from active sandbox AND blocked in-session!
  await json(await host.request(`/api/studio/resource-grants/${starGrantId}/revoke`, 'POST', {
    requestId: randomUUID(), revokerProjectId: projBuild.id, reason: '运行中即时撤回验证',
  }));
  assert.equal(fs.existsSync(path.join(sandboxCleanDir, 'starbridge_orders.csv')), false, 'Revoking detail grant MUST immediately purge starbridge_orders.csv from the active restricted task sandbox on disk!');
  let stepA4 = 0;
  let afterRevokeBlocked = false;
  provider.setResponder(context => {
    stepA4 += 1;
    if (stepA4 === 1) {
      return { calls: [{ name: 'read', arguments: { path: 'starbridge_orders.csv' } }] };
    }
    const txt = providerMessageText(context.recentToolResults.at(-1)!.content);
    afterRevokeBlocked = txt.includes('detail_access_not_authorized') || txt.includes('禁止读取项目 020_clean');
    return { text: '授权撤回后实时会话已立即拦截明细读取。' };
  });
  await json(await host.request(`/api/projects/${projStar.id}/tasks/${taskA.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '检查授权撤回后是否还能读取本店明细文件。',
  }), 202);
  await waitIdle(host, projStar.id, taskA.id, stateATurn3.snapshot.messages.length + 2);
  assert.equal(afterRevokeBlocked, true, 'Revoking detail grant MUST immediately block native reads in the active session!');

  // Grant projAud BOTH stores and run brand-new independent Task B discovering v1.1 + real Python recalculation!
  await json(await host.request('/api/studio/resource-grants', 'POST', {
    requestId: randomUUID(), enterpriseId, grantorProjectId: projBuild.id, grantBasis: '独立核算岗全店复算',
    subjectType: 'project', subjectId: projAud.id, resourceKind: 'detail',
    purposeKeys: ['store-first-purchase-30d-repurchase'], operations: ['read-definition', 'read-detail-recalculate'],
    scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店', '柳岸直营店'], allowedDataPaths: ['020_clean/starbridge_orders.csv', '020_clean/willowbank_orders.csv'] },
  }));

  const { task: taskB } = await json(await host.request(`/api/projects/${projAud.id}/tasks`, 'POST', { name: '独立新任务核对新版' }), 201);
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
      // Real Python calculation applying v1.1 cross-month refund rule -> C07 excluded (changed), C13 retained (unchanged) -> 2/4!
      const pyCmd = `python3 -c "import csv, json; rows = list(csv.DictReader(open('starbridge_orders.csv'))); rep = [r['account'] for r in rows if r['repeat_order_id'] and not (r['full_refund']=='true' and r['refund_date'] <= '2026-10-31')]; open('../060_reports/repurchase-v1.1.json','w').write(json.dumps({'packVersion':'1.1','numerator':len(rep),'denominator':len(rows),'accounts':rep,'c07Excluded':'C07' not in rep,'c13Retained':'C13' in rep}, ensure_ascii=False))"`;
      return { calls: [{ name: 'bash', arguments: { command: pyCmd } }] };
    }
    return { text: '独立新任务已查读 v1.1（销售退款映射 v2 + 复购指标 1.1.0）并完成 Python 复算：C07 跨月全额退款排除（应变），C13 有效再购保留（应保留），9 月星桥复购率为 2/4，结果已写入 060_reports/repurchase-v1.1.json。' };
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

  // R4.2 COUNTEREXAMPLE: Recording use WITHOUT bound authorDeclaration MUST keep verifyUse at 'pending' (NEVER 'pass')!
  const useBNoDecl = await json(await host.request(`/api/studio/enterprise-packs/${packId}/uses`, 'POST', {
    requestId: randomUUID(),
    projectId: projAud.id,
    taskId: taskB.id,
    sessionId: assistantMsgB.nativeSessionId,
    messageId: assistantMsgB.nativeEntryId,
    purposeId: purpose.id,
    accessLevel: 'recalculate',
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
  const verifyNoDecl = await json(await host.request(`/api/studio/enterprise-packs/${packId}/uses/${useBNoDecl.use.id}/verify`, 'POST', {
    requestId: randomUUID(),
    verifierRole: '独立核算复核',
    expectedRef: refundV2Ref,
    independentConfirmed: true,
    verdictDetail: '无作者采用声明反例',
  }));
  assert.equal(verifyNoDecl.use.independentVerification.status, 'pending', 'Missing bound authorDeclaration MUST keep verdict pending!');

  // With bound authorDeclaration -> verifyUse passes AND independent Task B v1.1 cleanly closes fb1!
  const useB = await json(await host.request(`/api/studio/enterprise-packs/${packId}/uses`, 'POST', {
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
      summaryText: '独立新任务作者声明：按 v1.1 核得星桥 2/4（C07 排除、C13 保留）',
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
  assert.equal(useB.use.actualReads.length, 2);

  const verifiedUse = await json(await host.request(`/api/studio/enterprise-packs/${packId}/uses/${useB.use.id}/verify`, 'POST', {
    requestId: randomUUID(),
    verifierRole: '独立核算复核',
    expectedRef: refundV2Ref,
    independentConfirmed: true,
    verdictDetail: '核实读对 v1.1（refund v2 + sap 1.1.0），C07 排除、C13 保留，分子分母 2/4 无误',
    checkedRefs: [refundV2Ref, sapM2Ref],
  }));
  assert.equal(verifiedUse.use.independentVerification.status, 'pass');

  const closedFb = await json(await host.request(`/api/studio/enterprise-packs/${packId}/feedback/${fb1.feedback.id}/handle`, 'POST', {
    requestId: randomUUID(),
    projectId: projBuild.id,
    status: 'verified',
    note: '已由独立新任务按 v1.1 复算通过闭环',
    revisedRef: refundV2Ref,
    revisedPackVersion: '1.1',
    verifiedByUseId: useB.use.id,
  }));
  assert.equal(closedFb.feedback.status, 'verified');
  assert.equal(closedFb.feedback.revisionLink.fromPackVersion, '1.0');
  assert.equal(closedFb.feedback.revisionLink.toPackVersion, '1.1');
  assert.equal(closedFb.feedback.revisionLink.authorityUpdates.length, 1);

  // Confirm Task A pin remained 1.0, Task B pin is 1.1, and Task A's historical report file is untouched!
  const finalPack = await json(await host.request(`/api/studio/enterprise-packs/${packId}`));
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
  await waitIdle(roHost, projAud.id, taskRollback.id);
  assert.match(catalogRollbackText, /"readOnlyRollback":true/, 'Rollback mode MUST signal readOnlyRollback: true!');
  assert.match(catalogRollbackText, /"pinnedVersion":null/, 'Brand-new task in rollback mode MUST NOT pin a pack version!');
  assert.match(catalogRollbackText, /"purposes":\[\]/, 'Brand-new task in rollback mode MUST receive ZERO pack purposes/dependencies!');
});
