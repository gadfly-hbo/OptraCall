import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DomainReferenceStore } from '../src/host/domain-reference-store.ts';
import { ResourceGrantStore } from '../src/host/resource-grant-store.ts';
import { EnterprisePackStore } from '../src/host/enterprise-pack-store.ts';
import {
  evaluateExceptionsAndWindow,
  evaluateResourceAccess,
  evaluateUseVerdict,
  computeUpgradeImpact,
} from '../extensions/business-plugins/studio/enterprise-pack.ts';

function tempRoot(label: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `optracall-member-pack-${label}-`));
}

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

test('Reference registration deduplicates same source+version across routes, preserves conflicts without overwriting, coexists versions, and refuses unreadable placeholders as readable', () => {
  const root = tempRoot('refs');
  try {
    const store = new DomainReferenceStore(root, process.cwd());

    // 1. Built-in repository Nike T03 & T04 register with real verified SHA-256
    const nikeT03 = store.registerRepoTemplate('T03');
    const nikeT04 = store.registerRepoTemplate('T04');
    assert.equal(nikeT03.outcome, 'created');
    assert.equal(nikeT03.record.contentStatus, 'available');
    assert.equal(nikeT03.record.contentSha256, '8c64c78a30876c8607c5c32af78bed38e7b662b26354828dd3cd1097a15b4895');
    assert.equal(nikeT04.record.contentStatus, 'available');
    assert.equal(nikeT04.record.contentSha256, '49a33bfc8f6be8d21df4b9a1140f1d966705c0554f83c03aefa1fb85a87200b7');

    // 2. Same source+version referenced from both enterprise & domain routes merges into ONE record
    const jnbyBody = 'JNBY benchmark third-party research v0.1 synthetic fixture body.';
    const firstJnby = store.register({
      sourceId: 'DAP-BENCH-JNBY-MEMBER-001',
      version: '0.1',
      title: '江南布衣会员标杆研究',
      domain: 'benchmark',
      routes: ['enterprise'],
      maintainer: '研究资料归档',
      scope: '集团多品牌会员运营公开研究（主品牌 JNBY 女装入口）',
      evidenceNature: 'third-party-research',
      evidenceRestrictions: ['第三方公开研究', '活跃指标存在媒体转述', '会员分级存在报道分歧', '不替代企业正式口径'],
      locator: 'synthetic://benchmark-jnby-member-domain-asset-package.md',
      visibility: 'shared',
      contentBody: jnbyBody,
    });
    assert.equal(firstJnby.outcome, 'created');
    const secondJnby = store.register({
      sourceId: 'DAP-BENCH-JNBY-MEMBER-001',
      version: '0.1',
      title: '江南布衣会员标杆研究',
      domain: 'benchmark',
      routes: ['domain'],
      maintainer: '研究资料归档',
      scope: '集团多品牌会员运营公开研究',
      evidenceNature: 'third-party-research',
      evidenceRestrictions: ['第三方公开研究'],
      locator: 'alt-path://benchmark-jnby-member-domain-asset-package.md',
      visibility: 'shared',
      contentBody: jnbyBody,
    });
    assert.equal(secondJnby.outcome, 'reused');
    assert.equal(secondJnby.record.id, firstJnby.record.id);
    assert.deepEqual([...secondJnby.record.routes].sort(), ['domain', 'enterprise']);

    // 3. Same source+version with DIFFERENT body keeps original approved version & records pending conflict
    const conflictingBody = 'JNBY benchmark altered body text!';
    const conflictResult = store.register({
      sourceId: 'DAP-BENCH-JNBY-MEMBER-001',
      version: '0.1',
      title: '江南布衣会员标杆研究（异文）',
      domain: 'benchmark',
      routes: ['domain'],
      maintainer: '未知上传',
      scope: '集团多品牌',
      evidenceNature: 'third-party-research',
      evidenceRestrictions: ['第三方公开研究'],
      locator: 'conflict://jnby.md',
      visibility: 'shared',
      contentBody: conflictingBody,
    });
    assert.equal(conflictResult.outcome, 'conflict');
    assert.equal(conflictResult.record.contentSha256, sha(jnbyBody));
    assert.equal(conflictResult.record.contentBody, jnbyBody);
    assert.equal(conflictResult.record.conflicts.length, 1);
    assert.equal(conflictResult.record.conflicts[0]!.incomingSha256, sha(conflictingBody));
    assert.equal(conflictResult.record.conflicts[0]!.status, 'pending');

    // 4. Newer version coexists alongside old version
    const jnbyV2 = store.register({
      sourceId: 'DAP-BENCH-JNBY-MEMBER-001',
      version: '0.2',
      title: '江南布衣会员标杆研究 v0.2',
      domain: 'benchmark',
      routes: ['domain'],
      maintainer: '研究资料归档',
      scope: '集团多品牌更新版',
      evidenceNature: 'third-party-research',
      evidenceRestrictions: ['第三方公开研究'],
      locator: 'synthetic://jnby-v0.2.md',
      visibility: 'shared',
      contentBody: 'JNBY v0.2 updated text',
    });
    assert.equal(jnbyV2.outcome, 'created');
    const versions = store.list({ sourceId: 'DAP-BENCH-JNBY-MEMBER-001' });
    assert.equal(versions.length, 2);

    // 5. Missing original content stays pending_source and is NOT eligible as readable original
    const pendingRef = store.register({
      sourceId: 'DAP-SUPPLY-001',
      version: '0.1',
      title: '供应链领域包（通用）',
      domain: 'supply',
      routes: ['domain'],
      maintainer: '通用模板维护方',
      scope: '采购、交期、调拨、履约',
      evidenceNature: 'generic-draft',
      evidenceRestrictions: ['通用参考草案'],
      locator: 'external://supply-domain-asset-package.md',
      visibility: 'public',
      missingFields: ['原件正文未接入当前隔离环境'],
    });
    assert.equal(pendingRef.record.contentStatus, 'pending_source');
    assert.equal(pendingRef.record.contentSha256, undefined);
    assert.throws(() => store.readOriginal(pendingRef.record.id), /domain_reference_source_unavailable/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Resource authorization separates definition, summary citation, and store-scoped detail recalculation, rejects revoked grants and never treats unreadable stores as zero', () => {
  const root = tempRoot('grants');
  try {
    const store = new ResourceGrantStore(root);
    const enterpriseId = '11111111-1111-4111-8111-111111111111';
    const hqProject = '22222222-2222-4222-8222-222222222222';
    const merchProject = '33333333-3333-4333-8333-333333333333';
    const starbridgeProject = '44444444-4444-4444-8444-444444444444';
    const auditorProject = '55555555-5555-4555-8555-555555555555';

    const metricRef = { authority: 'sap-metric' as const, id: 'member-repurchase', version: '1.0.0', sha256: sha('m5') };
    const summaryRef = { authority: 'studio-source' as const, id: '66666666-6666-4666-8666-666666666666', version: '1', sha256: sha('summary-sep') };

    // Merchandising: definition only
    store.grant({
      enterpriseId,
      grantor: '企业资料原权责方',
      grantBasis: '商品部口径查阅授权',
      subjectType: 'project',
      subjectId: merchProject,
      resourceKind: 'definition',
      purposeKeys: ['store-first-purchase-30d-repurchase'],
      operations: ['read-definition'],
      scope: { brand: '岚线', channel: '直营' },
    });

    // HQ monthly report: definition + cite specific published summary
    store.grant({
      enterpriseId,
      grantor: '企业资料原权责方',
      grantBasis: '总部月报引用授权',
      subjectType: 'project',
      subjectId: hqProject,
      resourceKind: 'summary',
      resourceRef: summaryRef,
      purposeKeys: ['store-first-purchase-30d-repurchase'],
      operations: ['read-definition', 'cite-summary'],
      scope: {
        brand: '岚线',
        channel: '直营',
        stores: ['星桥直营店'],
        periodFrom: '2026-09-01',
        periodTo: '2026-09-30',
        grain: 'store-month',
        summaryAssetId: summaryRef.id,
        summaryVersion: '1',
        summaryAuthority: '总部经营分析中心',
        metricRef,
      },
    });

    // Starbridge store: own store detail + cite summary, NO Willowbank detail
    store.grant({
      enterpriseId,
      grantor: '企业资料原权责方',
      grantBasis: '星桥店长本店明细授权',
      subjectType: 'project',
      subjectId: starbridgeProject,
      resourceKind: 'detail',
      purposeKeys: ['store-first-purchase-30d-repurchase'],
      operations: ['read-definition', 'cite-summary', 'read-detail-recalculate'],
      scope: {
        brand: '岚线',
        channel: '直营',
        stores: ['星桥直营店'],
        periodFrom: '2026-09-01',
        periodTo: '2026-10-31',
        grain: 'order-member',
        allowedDataPaths: ['020_clean/starbridge_orders.csv'],
        summaryAssetId: summaryRef.id,
        summaryVersion: '1',
        summaryAuthority: '总部经营分析中心',
        metricRef,
      },
    });

    // Cross-store auditor: both Starbridge & Willowbank detail
    const auditorGrant = store.grant({
      enterpriseId,
      grantor: '企业资料原权责方',
      grantBasis: '两店数据核算岗跨店复算授权',
      subjectType: 'project',
      subjectId: auditorProject,
      resourceKind: 'detail',
      purposeKeys: ['store-first-purchase-30d-repurchase'],
      operations: ['read-definition', 'read-detail-recalculate'],
      scope: {
        brand: '岚线',
        channel: '直营',
        stores: ['星桥直营店', '柳岸直营店'],
        periodFrom: '2026-09-01',
        periodTo: '2026-10-31',
        grain: 'order-member',
        allowedDataPaths: ['020_clean/starbridge_orders.csv', '020_clean/willowbank_orders.csv'],
      },
    });

    // Verify Merchandising: definition allowed, summary & detail denied
    const merchDef = evaluateResourceAccess(store.listForSubject(enterpriseId, merchProject), {
      operation: 'read-definition',
      purposeKey: 'store-first-purchase-30d-repurchase',
    });
    assert.equal(merchDef.allowed, true);
    const merchSummary = evaluateResourceAccess(store.listForSubject(enterpriseId, merchProject), {
      operation: 'cite-summary',
      purposeKey: 'store-first-purchase-30d-repurchase',
      grain: 'category-month',
    });
    assert.equal(merchSummary.allowed, false);

    // Verify HQ: summary allowed at exact store-month grain, detail denied
    const hqSummary = evaluateResourceAccess(store.listForSubject(enterpriseId, hqProject), {
      operation: 'cite-summary',
      purposeKey: 'store-first-purchase-30d-repurchase',
      grain: 'store-month',
      summaryVersion: '1',
      metricRef,
    });
    assert.equal(hqSummary.allowed, true);
    const hqDetail = evaluateResourceAccess(store.listForSubject(enterpriseId, hqProject), {
      operation: 'read-detail-recalculate',
      purposeKey: 'store-first-purchase-30d-repurchase',
      stores: ['星桥直营店'],
    });
    assert.equal(hqDetail.allowed, false);

    // Verify Starbridge store: Starbridge detail allowed, cross-store with Willowbank denied with neverTreatAsZero
    const starOwn = evaluateResourceAccess(store.listForSubject(enterpriseId, starbridgeProject), {
      operation: 'read-detail-recalculate',
      purposeKey: 'store-first-purchase-30d-repurchase',
      stores: ['星桥直营店'],
      dataPath: '020_clean/starbridge_orders.csv',
    });
    assert.equal(starOwn.allowed, true);
    const starCross = evaluateResourceAccess(store.listForSubject(enterpriseId, starbridgeProject), {
      operation: 'read-detail-recalculate',
      purposeKey: 'store-first-purchase-30d-repurchase',
      stores: ['星桥直营店', '柳岸直营店'],
    });
    assert.equal(starCross.allowed, false);
    assert.deepEqual(starCross.deniedStores, ['柳岸直营店']);
    assert.equal(starCross.neverTreatAsZero, true);
    const starOtherFile = evaluateResourceAccess(store.listForSubject(enterpriseId, starbridgeProject), {
      operation: 'read-detail-recalculate',
      purposeKey: 'store-first-purchase-30d-repurchase',
      dataPath: '020_clean/willowbank_orders.csv',
    });
    assert.equal(starOtherFile.allowed, false);

    // Verify Auditor: cross-store allowed before revocation, denied immediately after revocation
    const audBefore = evaluateResourceAccess(store.listForSubject(enterpriseId, auditorProject), {
      operation: 'read-detail-recalculate',
      purposeKey: 'store-first-purchase-30d-repurchase',
      stores: ['星桥直营店', '柳岸直营店'],
      dataPath: '020_clean/willowbank_orders.csv',
    });
    assert.equal(audBefore.allowed, true);

    store.revoke(auditorGrant.id, '季度权限复核撤回');
    const audAfter = evaluateResourceAccess(store.listForSubject(enterpriseId, auditorProject), {
      operation: 'read-detail-recalculate',
      purposeKey: 'store-first-purchase-30d-repurchase',
      stores: ['星桥直营店', '柳岸直营店'],
    });
    assert.equal(audAfter.allowed, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('EnterprisePackStore handles panorama, two-route single-decision entries, cross-project/concurrent purpose dedupe, partial publication with dependency suspension & idempotent recovery, task version pinning, exceptions/overlap/window/opt-out, and feedback→revision→new-version loop', () => {
  const root = tempRoot('pack');
  try {
    const store = new EnterprisePackStore(root);
    const enterpriseId = '11111111-1111-4111-8111-111111111111';
    const systemId = '22222222-2222-4222-8222-222222222222';
    const projA = '33333333-3333-4333-8333-333333333333';
    const taskA = '44444444-4444-4444-8444-444444444444';
    const projB = '55555555-5555-4555-8555-555555555555';
    const taskB = '66666666-6666-4666-8666-666666666666';

    // 1. Create or reuse single enterprise pack anchored on (enterpriseId, domain)
    const pack1 = store.ensurePack({ enterpriseId, systemId, domain: 'member-operations', name: '织屿服饰 · 会员运营资产包' });
    const pack2 = store.ensurePack({ enterpriseId, systemId, domain: 'member-operations', name: '织屿服饰 · 会员运营资产包' });
    assert.equal(pack1.id, pack2.id);

    // 2. Save wide-goal panorama with 0 pending questions allowed
    const policyRef = { authority: 'data' as const, id: sha('020_clean/member_policy.md'), version: sha('policy-v1'), sha256: sha('policy-v1'), projectId: projA, locator: '020_clean/member_policy.md', title: '会员运营制度' };
    const monthlyRef = { authority: 'data' as const, id: sha('020_clean/sep_monthly.md'), version: sha('monthly-v1'), sha256: sha('monthly-v1'), projectId: projA, locator: '020_clean/sep_monthly.md', title: '9月月报' };
    const schemaRef = { authority: 'data' as const, id: sha('020_clean/schema.json'), version: sha('schema-v1'), sha256: sha('schema-v1'), projectId: projA, locator: '020_clean/schema.json', title: '字段说明表' };

    const withPanorama = store.savePanorama(pack1.id, {
      goal: '盘点会员运营现状并给出首批建设建议',
      brand: '岚线',
      channel: '直营门店',
      period: '2026-09',
      dataCutoffAt: '2026-10-31',
      decisionPurpose: '决定首批优先建设哪些会员运营用途',
      sourceRefs: [policyRef, monthlyRef, schemaRef],
      recommendations: [
        {
          purposeKey: 'store-first-purchase-30d-repurchase',
          title: '门店首购后 30 日有效复购率',
          priorityReason: '月报把门店复购列为复盘议题，跨店归属与退款关联会改变门店排名',
          deliverableNow: '星桥正式定义与计算、柳岸资料期内首次可见购买受限计算',
          minimumEvidence: '核查门店映射、退款映射与两店历史起点',
          ownerRole: '会员运营负责人',
          completionCriteria: '输出可核分子分母与观察窗限制；历史较短门店另名不直接排名',
        },
      ],
      issues: [
        {
          id: 'iss-coupon',
          problemName: '生日券预算',
          businessStatus: 'active',
          assetSupportStatus: 'gap_material',
          summary: '制度规定发券、月报有发放量、字段仅有到期日，仍缺核销依据',
          factOrInference: 'fact',
          decisionImpact: '核销率与券预算尚无法直接计算',
          nextStep: '补齐券核销明细字段映射',
          evidence: [{ sourceRef: policyRef, locator: '§3.2', scope: '岚线直营' }],
          candidatePurposeKey: 'birthday-coupon-budget',
        },
        {
          id: 'iss-points',
          problemName: '积分兑换',
          businessStatus: 'not_launched',
          assetSupportStatus: 'not_needed',
          summary: '制度明文写明岚线本期未开通积分',
          factOrInference: 'fact',
          decisionImpact: '本期无需建设',
          nextStep: '无',
          evidence: [{ sourceRef: policyRef, locator: '§5.1', scope: '岚线直营' }],
        },
        {
          id: 'iss-paid',
          problemName: '付费会员计划',
          businessStatus: 'unknown',
          assetSupportStatus: 'gap_material',
          summary: '三份资料均未提及付费计划',
          factOrInference: 'inference',
          decisionImpact: '开展情况待核',
          nextStep: '业务确认是否立项',
          evidence: [],
        },
      ],
      pendingQuestions: [],
      createdByTask: { projectId: projA, taskId: taskA },
    });
    assert.equal(withPanorama.panorama?.pendingQuestions.length, 0);
    assert.equal(withPanorama.panorama?.issues.length, 3);

    // 3. Upsert enterprise entry merging BOTH enterprise & domain routes into ONE enterprise decision
    const entry1 = store.upsertEntry(pack1.id, {
      entryKey: 'member_identity',
      title: '品牌内按账号去重',
      action: 'modify',
      routes: ['enterprise', 'domain'],
      referenceLinks: [
        { refId: 'ref-member', sourceId: 'DAP-MEMBER-001', version: '0.1', sectionLocator: 'L195-L215', evidenceNature: 'generic-draft' },
        { refId: 'ref-jnby', sourceId: 'DAP-BENCH-JNBY-MEMBER-001', version: '0.1', sectionLocator: '§4-§5', evidenceNature: 'third-party-research', restrictions: ['第三方研究'] },
      ],
      enterpriseBasis: '依据《会员制度》§2.1，岚线直营按品牌账号去重；集团同人另待核',
      decisionOwner: '织屿会员运营负责人',
      enterpriseSourceRefs: [policyRef],
      scope: '岚线直营门店',
      grain: 'brand_account',
      validFrom: '2026-09-01',
      impactedPurposeIds: [],
      exceptions: [],
    });
    assert.equal(entry1.entries.length, 1);
    assert.deepEqual([...entry1.entries[0]!.routes].sort(), ['domain', 'enterprise']);

    // 4. Cross-project & duplicate purpose initiation deduplicates by (enterpriseId, packId, purposeKey, subjectUnit, scopeKey, windowDays)
    const refundR3 = { authority: 'studio-source' as const, id: '77777777-7777-4777-8777-777777777777', version: '3', sha256: sha('refund-r3'), title: '销售退款映射 r3' };
    const memberRuleR1 = { authority: 'studio-source' as const, id: '88888888-8888-4888-8888-888888888888', version: '1', sha256: sha('member-r1'), title: '会员有效购买 r1' };
    const sapM5 = { authority: 'sap-metric' as const, id: 'member-repurchase', version: '1.0.0', sha256: sha('sap-m5'), title: '复购指标 m5' };

    const pFirst = store.upsertPurpose(pack1.id, {
      purposeKey: 'store-first-purchase-30d-repurchase',
      title: '门店首购后 30 日有效复购率',
      businessQuestion: '哪些门店的首购会员 30 日复购偏低？',
      subjectUnit: 'brand_account',
      windowDays: 30,
      scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店'], period: '2026-09', scopeKey: 'lanxian:direct:starbridge:2026-09' },
      tier: 'formal-calculation',
      businessStatus: 'active',
      originalGoal: '衡量星桥直营店首购会员 30 日复购率',
      remainingGaps: [],
      exclusions: ['未满 30 日观察窗', '身份未知'],
      completionCriteria: '输出可复算分子分母',
      dependencies: [
        { id: 'dep-refund', role: 'shared-asset', authority: 'studio-source', ref: refundR3, requiredFor: ['formal-calculation', 'limited-calculation'] },
        { id: 'dep-rule', role: 'member-rule', authority: 'studio-source', ref: memberRuleR1, requiredFor: ['definition-reference', 'limited-calculation', 'formal-calculation'] },
        { id: 'dep-sap', role: 'sap-metric', authority: 'sap-metric', ref: sapM5, requiredFor: ['formal-calculation', 'limited-calculation'] },
      ],
      policyEffectiveFrom: '2026-09-01',
      dataCutoffAt: '2026-10-31',
      observationWindowDays: 30,
      availableHistoryDays: 60,
      decisionChoices: [
        {
          id: 'cross-store-scope',
          question: '会员在星桥首购、20天后在柳岸再购，是否计入星桥复购分子？',
          options: [
            { key: 'any-direct', label: '计入（任一获准直营店再购）', impact: '衡量首购店获取会员在品牌内的持续复购' },
            { key: 'same-store', label: '不计入（仅回原店再购）', impact: '衡量门店自身留存能力' },
          ],
        },
      ],
      taskOwner: { projectId: projA, taskId: taskA },
      evidenceNote: { projectId: projA, taskId: taskA, note: '星桥 4 账号首购凭证已核', sourceRefs: [policyRef] },
    });
    assert.equal(pFirst.created, true);

    // Same purpose+scope from Project B merges into SAME purpose ID, adds evidence once
    const pSecond = store.upsertPurpose(pack1.id, {
      purposeKey: 'store-first-purchase-30d-repurchase',
      title: '门店首购后 30 日有效复购率（换项目续建）',
      businessQuestion: '哪些门店的首购会员 30 日复购偏低？',
      subjectUnit: 'brand_account',
      windowDays: 30,
      scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店'], period: '2026-09', scopeKey: 'lanxian:direct:starbridge:2026-09' },
      tier: 'formal-calculation',
      businessStatus: 'active',
      originalGoal: '衡量星桥直营店首购会员 30 日复购率',
      remainingGaps: [],
      exclusions: ['未满 30 日观察窗'],
      completionCriteria: '输出可复算分子分母',
      dependencies: [],
      taskOwner: { projectId: projB, taskId: taskB },
      evidenceNote: { projectId: projB, taskId: taskB, note: '乙店补证说明', sourceRefs: [monthlyRef] },
    });
    assert.equal(pSecond.created, false);
    assert.equal(pSecond.purpose.id, pFirst.purpose.id);
    // Repeat identical evidence note does not duplicate
    const pSecondRepeat = store.upsertPurpose(pack1.id, {
      purposeKey: 'store-first-purchase-30d-repurchase',
      title: '门店首购后 30 日有效复购率',
      businessQuestion: '哪些门店的首购会员 30 日复购偏低？',
      subjectUnit: 'brand_account',
      windowDays: 30,
      scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店'], period: '2026-09', scopeKey: 'lanxian:direct:starbridge:2026-09' },
      tier: 'formal-calculation',
      businessStatus: 'active',
      originalGoal: '衡量星桥直营店首购会员 30 日复购率',
      remainingGaps: [],
      exclusions: [],
      completionCriteria: '输出可复算分子分母',
      dependencies: [],
      taskOwner: { projectId: projB, taskId: taskB },
      evidenceNote: { projectId: projB, taskId: taskB, note: '乙店补证说明', sourceRefs: [monthlyRef] },
    });
    assert.equal(pSecondRepeat.purpose.evidenceNotes.length, 2);

    // Different tier / store limited calculation + different subjectUnit (group_person) + 60-day window coexist!
    const pDef = store.upsertPurpose(pack1.id, {
      purposeKey: 'store-first-purchase-30d-repurchase-def',
      title: '门店复购定义参考',
      businessQuestion: '解释门店首购后 30 日有效复购率口径',
      subjectUnit: 'brand_account',
      windowDays: 30,
      scope: { brand: '岚线', channel: '直营', scopeKey: 'lanxian:direct:all' },
      tier: 'definition-reference',
      businessStatus: 'active',
      originalGoal: '发布正式口径定义',
      remainingGaps: [],
      exclusions: ['未成熟观察窗'],
      completionCriteria: '可清晰解释分子分母与跨店归属',
      dependencies: [{ id: 'dep-rule-def', role: 'member-rule', authority: 'studio-source', ref: memberRuleR1, requiredFor: ['definition-reference'] }],
      policyEffectiveFrom: '2026-09-01',
      dataCutoffAt: '2026-10-31',
      taskOwner: { projectId: projA, taskId: taskA },
    });
    const pLimited = store.upsertPurpose(pack1.id, {
      purposeKey: 'store-first-visible-purchase-30d-repurchase',
      title: '资料期内首次可见购买后 30 日复购率',
      businessQuestion: '柳岸直营店 9 月首次可见购买后 30 日复购',
      subjectUnit: 'brand_account',
      windowDays: 30,
      scope: { brand: '岚线', channel: '直营', stores: ['柳岸直营店'], period: '2026-09', scopeKey: 'lanxian:direct:willowbank:2026-09' },
      tier: 'limited-calculation',
      limitedCalculationName: '资料期内首次可见购买后 30 日复购率',
      businessStatus: 'active',
      originalGoal: '柳岸直营店复购评估（缺少 9 月前品牌首购历史）',
      deliveredSubset: '仅 9 月 1 日起资料期内首次可见购买，暂停与星桥排名',
      remainingGaps: ['缺少迁入前全品牌首购凭证'],
      exclusions: ['不可跨店直接排名'],
      completionCriteria: '给出有限范围结果与起止日期',
      dependencies: [
        { id: 'dep-refund-lim', role: 'shared-asset', authority: 'studio-source', ref: refundR3, requiredFor: ['limited-calculation'] },
        { id: 'dep-sap-lim', role: 'sap-metric', authority: 'sap-metric', ref: sapM5, requiredFor: ['limited-calculation'] },
      ],
      policyEffectiveFrom: '2026-09-01',
      dataCutoffAt: '2026-10-31',
      observationWindowDays: 30,
      availableHistoryDays: 60,
      taskOwner: { projectId: projA, taskId: taskA },
    });
    const pGroup60 = store.upsertPurpose(pack1.id, {
      purposeKey: 'store-first-purchase-30d-repurchase',
      title: '集团按人 60 日复购率',
      businessQuestion: '集团按人 60 日复购',
      subjectUnit: 'group_person',
      windowDays: 60,
      scope: { brand: '集团', channel: '全渠道', scopeKey: 'group:all:60d' },
      tier: 'definition-reference',
      businessStatus: 'unknown',
      originalGoal: '集团口径定义参考',
      remainingGaps: ['跨品牌同人依据待核'],
      exclusions: [],
      completionCriteria: '集团口径明确',
      dependencies: [{ id: 'dep-rule-grp', role: 'member-rule', authority: 'studio-source', ref: memberRuleR1, requiredFor: ['definition-reference'] }],
      taskOwner: { projectId: projA, taskId: taskA },
    });
    assert.notEqual(pGroup60.purpose.id, pFirst.purpose.id);

    // 5. One preview, partial publication: SAP receipt UNKNOWN suspends calc purposes while definition stays eligible!
    const preview = store.preparePreview(pack1.id, {
      version: '1.0',
      purposeIds: [pDef.purpose.id, pFirst.purpose.id, pLimited.purpose.id],
      decisions: [{ purposeId: pFirst.purpose.id, choiceId: 'cross-store-scope', selectedKey: 'any-direct', decidedBy: '会员运营负责人' }],
      policyEffectiveFrom: '2026-09-01',
      dataCutoffAt: '2026-10-31',
      summary: '会员运营资产包首版发布预览',
    });
    assert.equal(preview.fingerprint.length, 64);

    const confirm1 = store.confirmPreview(pack1.id, {
      previewId: preview.id,
      fingerprint: preview.fingerprint,
      confirmedBy: '会员运营负责人',
      moduleReceipts: [
        { requestId: 'P-030', authority: 'shared-asset', targetRef: refundR3, status: 'succeeded', detail: '引用销售退款映射 r3', purposeIds: [pFirst.purpose.id, pLimited.purpose.id] },
        { requestId: 'P-031', authority: 'member-rule', targetRef: memberRuleR1, status: 'succeeded', detail: '会员有效购买 r1 生效', purposeIds: [pDef.purpose.id, pFirst.purpose.id, pLimited.purpose.id] },
        { requestId: 'P-032', authority: 'sap-metric', targetRef: sapM5, status: 'unknown', detail: '网络超时，原请求 P-032 结果未知', purposeIds: [pFirst.purpose.id, pLimited.purpose.id] },
      ],
    });
    assert.equal(confirm1.version, '1.0');
    const defState = confirm1.purposeManifests.find(p => p.purposeId === pDef.purpose.id)!;
    const calcState = confirm1.purposeManifests.find(p => p.purposeId === pFirst.purpose.id)!;
    const limState = confirm1.purposeManifests.find(p => p.purposeId === pLimited.purpose.id)!;
    assert.equal(defState.status, 'eligible');
    assert.equal(calcState.status, 'suspended');
    assert.equal(limState.status, 'suspended');

    // Idempotent retry of same previewId + fingerprint returns original revision without duplicating!
    const confirmRetry = store.confirmPreview(pack1.id, {
      previewId: preview.id,
      fingerprint: preview.fingerprint,
      confirmedBy: '会员运营负责人',
      moduleReceipts: [],
    });
    assert.equal(confirmRetry.manifestSha256, confirm1.manifestSha256);
    assert.equal(store.get(pack1.id).packRevisions.length, 1);

    // Reconcile P-032 as succeeded -> original unknown receipt preserved + new reconciled receipt appended, calc purposes become eligible!
    const reconciled = store.reconcileModuleReceipt(pack1.id, '1.0', {
      requestId: 'P-032',
      authority: 'sap-metric',
      targetRef: sapM5,
      status: 'succeeded',
      detail: '核对原请求 P-032 目标指纹一致，证实已成功',
      purposeIds: [pFirst.purpose.id, pLimited.purpose.id],
    });
    assert.equal(reconciled.moduleReceipts.filter(r => r.requestId === 'P-032').length, 2);
    assert.equal(reconciled.purposeManifests.find(p => p.purposeId === pFirst.purpose.id)!.status, 'eligible');
    assert.equal(reconciled.purposeManifests.find(p => p.purposeId === pLimited.purpose.id)!.status, 'eligible');

    // 6. Task-start version pinning: Task 1 pins v1.0; publishing v1.1 keeps Task 1 on v1.0 while Task 2 pins v1.1!
    const pin1 = store.pinTaskVersion(pack1.id, { projectId: projB, taskId: taskB, authorizedScope: '星桥直营店' });
    assert.equal(pin1.packVersion, '1.0');

    // 7. Record layered use evidence & test feedback dedupe + authoritative revision v1.1
    const reportV1 = { authority: 'task' as const, id: taskB, projectId: projB, taskId: taskB, version: sha('report-v1'), sha256: sha('report-v1'), locator: '060_reports/sep-repurchase-v1.md', title: '9月门店复购首版报告' };
    const use1 = store.recordUse(pack1.id, {
      projectId: projB,
      taskId: taskB,
      sessionId: 'sess-1',
      turnIndex: 1,
      messageId: 'msg-1',
      reportRef: reportV1,
      packVersion: '1.0',
      purposeId: pFirst.purpose.id,
      purposeKey: pFirst.purpose.purposeKey,
      tier: 'formal-calculation',
      accessLevel: 'recalculate',
      dataCutoffAt: '2026-10-31',
      catalogSupplied: { packVersion: '1.0', purposeIds: [pFirst.purpose.id], assetRefs: [refundR3, memberRuleR1, sapM5], suppliedAt: new Date().toISOString() },
      actualReads: [
        { ref: refundR3, sha256: refundR3.sha256, complete: true, readAt: new Date().toISOString(), turnIndex: 1 },
        { ref: sapM5, sha256: sapM5.sha256, complete: true, readAt: new Date().toISOString(), turnIndex: 1 },
      ],
      authorDeclaration: { declaredPurposeId: pFirst.purpose.id, declaredRefs: [refundR3, sapM5], summaryText: '星桥 3/4 复购', declaredAt: new Date().toISOString() },
    });
    assert.equal(use1.independentVerification.status, 'pending');

    // Submit feedback twice for same packVersion + same problem -> ONE feedback item, TWO evidence entries!
    const fb1 = store.submitFeedback(pack1.id, {
      problemKey: 'cross-month-full-refund-missed',
      packVersion: '1.0',
      purposeIds: [pFirst.purpose.id],
      title: '跨月全额退款漏连原单',
      category: 'shared_refund_mapping',
      report: { projectId: projB, taskId: taskB, sessionId: 'sess-1', messageId: 'msg-1', reportRef: reportV1, usedPackVersion: '1.0', usedAssetRefs: [refundR3, sapM5], dataCutoffAt: '2026-10-31', evidenceNote: '账号 C07 10月2日全额退款未冲销9月再购' },
    });
    const fb2 = store.submitFeedback(pack1.id, {
      problemKey: 'cross-month-full-refund-missed',
      packVersion: '1.0',
      purposeIds: [pFirst.purpose.id],
      title: '跨月全额退款漏连原单（补充）',
      category: 'shared_refund_mapping',
      report: { projectId: projB, taskId: taskB, sessionId: 'sess-1', messageId: 'msg-1', reportRef: reportV1, usedPackVersion: '1.0', usedAssetRefs: [refundR3, sapM5], dataCutoffAt: '2026-10-31', evidenceNote: '补充退款单号 R-02 在 10-31 截止前已可见' },
    });
    assert.equal(fb1.created, true);
    assert.equal(fb2.created, false);
    assert.equal(fb2.feedback.id, fb1.feedback.id);
    assert.equal(fb2.feedback.reports.length, 2);
    assert.equal(fb2.feedback.targetAuthority, 'shared-asset');

    // Publish v1.1 with refund r4 & sap m6; compute upgrade impact; verify Task 1 pin stays v1.0 and Task 3 gets v1.1!
    const refundR4 = { authority: 'studio-source' as const, id: '77777777-7777-4777-8777-777777777777', version: '4', sha256: sha('refund-r4'), title: '销售退款映射 r4' };
    const sapM6 = { authority: 'sap-metric' as const, id: 'member-repurchase', version: '1.1.0', sha256: sha('sap-m6'), title: '复购指标 m6' };
    store.upsertPurpose(pack1.id, {
      purposeKey: 'store-first-purchase-30d-repurchase',
      title: '门店首购后 30 日有效复购率',
      businessQuestion: '哪些门店的首购会员 30 日复购偏低？',
      subjectUnit: 'brand_account',
      windowDays: 30,
      scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店'], period: '2026-09', scopeKey: 'lanxian:direct:starbridge:2026-09' },
      tier: 'formal-calculation',
      businessStatus: 'active',
      originalGoal: '衡量星桥直营店首购会员 30 日复购率',
      remainingGaps: [],
      exclusions: ['未满 30 日观察窗'],
      completionCriteria: '输出可复算分子分母',
      dependencies: [
        { id: 'dep-refund', role: 'shared-asset', authority: 'studio-source', ref: refundR4, requiredFor: ['formal-calculation'] },
        { id: 'dep-rule', role: 'member-rule', authority: 'studio-source', ref: memberRuleR1, requiredFor: ['definition-reference', 'formal-calculation'] },
        { id: 'dep-sap', role: 'sap-metric', authority: 'sap-metric', ref: sapM6, requiredFor: ['formal-calculation'] },
      ],
      policyEffectiveFrom: '2026-09-01',
      dataCutoffAt: '2026-10-31',
      taskOwner: { projectId: projA, taskId: taskA },
    });
    const prevV2 = store.preparePreview(pack1.id, {
      version: '1.1',
      previousVersion: '1.0',
      purposeIds: [pDef.purpose.id, pFirst.purpose.id],
      decisions: [{ purposeId: pFirst.purpose.id, choiceId: 'cross-store-scope', selectedKey: 'any-direct', decidedBy: '会员运营负责人' }],
      policyEffectiveFrom: '2026-09-01',
      dataCutoffAt: '2026-10-31',
      summary: '修订跨月全额退款映射 r3 → r4',
    });
    const revV2 = store.confirmPreview(pack1.id, {
      previewId: prevV2.id,
      fingerprint: prevV2.fingerprint,
      confirmedBy: '会员运营负责人',
      moduleReceipts: [
        { requestId: 'P-041', authority: 'shared-asset', targetRef: refundR4, status: 'succeeded', detail: '退款映射 r4 已发布', purposeIds: [pFirst.purpose.id] },
        { requestId: 'P-042', authority: 'member-rule', targetRef: memberRuleR1, status: 'succeeded', detail: '沿用 r1', purposeIds: [pDef.purpose.id, pFirst.purpose.id] },
        { requestId: 'P-043', authority: 'sap-metric', targetRef: sapM6, status: 'succeeded', detail: '复购指标 m6 已发布', purposeIds: [pFirst.purpose.id] },
      ],
    });
    assert.equal(revV2.version, '1.1');

    // Old task pin stays 1.0!
    assert.equal(store.getTaskPin(pack1.id, projB, taskB)?.packVersion, '1.0');
    // New independent task pins 1.1!
    const taskC = '99999999-9999-4999-8999-999999999999';
    const pin2 = store.pinTaskVersion(pack1.id, { projectId: projB, taskId: taskC, authorizedScope: '星桥直营店' });
    assert.equal(pin2.packVersion, '1.1');

    // Upgrade impact traces verified impacted calculation report vs unaffected definition-only report
    const impact = computeUpgradeImpact(store.get(pack1.id), {
      changedAuthorityRef: refundR3,
      replacementRef: refundR4,
      fromPackVersion: '1.0',
      toPackVersion: '1.1',
    });
    assert.equal(impact.verifiedImpactedUseIds.includes(use1.id), true);
    assert.equal(impact.impactedPurposeIds.includes(pFirst.purpose.id), true);
    assert.equal(impact.impactedPurposeIds.includes(pDef.purpose.id), false);

    // 8. Pure evaluation checks: exceptions, overlap conflict, 45d < 90d dormant window, opted-out SMS exclusion, wrong-version verdict FAIL
    const overlapCheck = evaluateExceptionsAndWindow({
      eventDate: '2026-09-15',
      storeId: '星桥直营店',
      eventType: 'exchange_reopen',
      exceptions: [
        { id: 'ex-1', replacesRuleKey: 'valid_purchase', eventType: 'exchange_reopen', scope: '试点店A', storeIds: ['星桥直营店'], effectiveFrom: '2026-09-01', effectiveTo: '2026-09-30', approvalBasis: '试点函1', approvedBy: '运营负责人', status: 'approved' },
        { id: 'ex-2', replacesRuleKey: 'valid_purchase', eventType: 'exchange_reopen', scope: '试点店B', storeIds: ['星桥直营店'], effectiveFrom: '2026-09-10', effectiveTo: '2026-09-20', approvalBasis: '试点函2', approvedBy: '区域负责人', status: 'approved' },
      ],
    });
    assert.equal(overlapCheck.overlapConflict, true);
    assert.equal(overlapCheck.status, 'conflict_blocked');

    const dormant45 = evaluateExceptionsAndWindow({
      eventDate: '2026-10-31',
      observationWindowDays: 90,
      availableHistoryDays: 45,
      optedOut: true,
    });
    assert.equal(dormant45.windowSufficient, false);
    assert.equal(dormant45.status, 'pending_history');
    assert.equal(dormant45.smsEligible, false);

    const wrongVersionVerdict = evaluateUseVerdict({
      expectedRef: refundR4,
      actualReads: [{ ref: refundR3, sha256: refundR3.sha256, complete: true, readAt: new Date().toISOString() }],
      hasAuthorDeclaration: true,
      independentConfirmed: true,
    });
    assert.equal(wrongVersionVerdict.verdict, 'fail');
    assert.equal(wrongVersionVerdict.wrongVersionDetected, true);

    const noReadEvidenceVerdict = evaluateUseVerdict({
      expectedRef: refundR4,
      actualReads: [],
      hasAuthorDeclaration: true,
      independentConfirmed: false,
    });
    assert.equal(noReadEvidenceVerdict.verdict, 'pending');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
