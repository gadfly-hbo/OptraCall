import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DomainReferenceStore } from '../src/host/domain-reference-store.ts';
import { isPeriodCovered, isSourcePeriodCovered } from '../src/host/member-pack-data-view.ts';
import { ResourceGrantStore } from '../src/host/resource-grant-store.ts';
import { EnterprisePackStore } from '../src/host/enterprise-pack-store.ts';
import {
  evaluateExceptionsAndWindow,
  evaluateResourceAccess,
  evaluateUseVerdict,
  computeUpgradeImpact,
  matchPanoramaRecommendationPurposes,
  type EnterprisePackPurpose,
  type EnterprisePanoramaRecommendation,
} from '../extensions/business-plugins/studio/enterprise-pack.ts';
import type { StudioSourceRef } from '../extensions/business-plugins/studio/contracts.ts';

function tempRoot(label: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `optracall-member-pack-${label}-`));
}

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

function sourceCustody(projectId: string, oldTaskId: string, newTaskId: string, rowNumber: number) {
  const locator = '020_clean/orders.csv';
  const sha256 = sha('account,order_id\nC07,O-73\nC13,O-81\nC21,O-21\n');
  const read = (taskId: string, turn: string) => ({
    ref: { authority: 'data' as const, id: sha(locator), locator, sha256, version: sha256, projectId, taskId },
    sessionId: turn, entryId: turn + '-entry', toolCallId: turn + '-call',
  });
  return {
    sourceFileLocator: locator, sourceFileSha256: sha256, sourceRowNumber: rowNumber,
    originalSourceRead: read(oldTaskId, 'original'), originalSourceRowNumber: rowNumber, originalSourceVisibleOn: '2026-10-01',
    revisedSourceRead: read(newTaskId, 'verified'), revisedSourceRowNumber: rowNumber, revisedSourceVisibleOn: '2026-10-01',
  };
}

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
      evidenceReadiness: { definition: 'pass', mapping: 'pass', sampleCalculation: 'pass' },
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

    const invalidPurposeList = {
      purposeKey: 'invalid-remaining-gaps-probe', title: '字段类型反例', businessQuestion: '验证 remainingGaps 必须为数组',
      subjectUnit: 'brand_account' as const, scope: { scopeKey: 'synthetic:invalid-list' }, tier: 'definition-reference' as const,
      businessStatus: 'active' as const, originalGoal: '工程字段校验', completionCriteria: '错误可定位且改正后继续',
      remainingGaps: '北岭缺档与南湾首购锚点未知' as unknown as string[], exclusions: [], dependencies: [],
    };
    assert.throws(() => store.upsertPurpose(pack1.id, invalidPurposeList), error => {
      const fault = error as Error & { code?: string; details?: { issues?: { reason: string; path?: string }[] } };
      assert.equal(fault.code, 'invalid_purpose_remaining_gaps');
      assert.match(fault.message, /remainingGaps.*数组/);
      assert.deepEqual(fault.details?.issues, [{ reason: 'expected_string_array', path: 'payload.remainingGaps' }]);
      return true;
    });
    const correctedPurposeList = store.upsertPurpose(pack1.id, { ...invalidPurposeList, remainingGaps: ['北岭缺档与南湾首购锚点未知'] });
    assert.equal(correctedPurposeList.created, true);

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
      evidenceReadiness: { definition: 'pass', mapping: 'pass', sampleCalculation: 'pass' },
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

    // Reconcile P-032 without original authority operation evidence MUST keep status unknown & purposes suspended!
    const reconciledNoEvidence = store.reconcileModuleReceipt(pack1.id, '1.0', {
      requestId: 'P-032',
      authority: 'sap-metric',
      targetRef: sapM5,
      status: 'succeeded',
      detail: '缺少原操作凭据的伪核对',
      purposeIds: [pFirst.purpose.id, pLimited.purpose.id],
    });
    assert.equal(reconciledNoEvidence.moduleReceipts.at(-1)!.status, 'unknown');
    assert.equal(reconciledNoEvidence.purposeManifests.find(p => p.purposeId === pFirst.purpose.id)!.status, 'suspended');

    // Reconcile P-032 WITH verified authorityPublishedBy -> original unknown receipt preserved + new reconciled receipt appended, calc purposes become eligible!
    const reconciled = store.reconcileModuleReceipt(pack1.id, '1.0', {
      requestId: 'P-032',
      authority: 'sap-metric',
      targetRef: sapM5,
      status: 'succeeded',
      detail: '核对原请求 P-032 目标指纹一致，证实已成功',
      authorityPublishedBy: `企业会员包:${pack1.packCode}:${preview.id}`,
      purposeIds: [pFirst.purpose.id, pLimited.purpose.id],
    });
    assert.equal(reconciled.moduleReceipts.filter(r => r.requestId === 'P-032').length, 3);
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
      declaredRefs: [refundR3],
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

test('Round-2 counterexamples: missing history/sample/deps never eligible, draft drift rejects stale preview, unresolved decider rejected, distinct-store/event overlapping-date exceptions do not falsely conflict, dual-route upsertEntry preserves both sources, reference readOriginal slices exact section, and readOnlyMode blocks all 3 stores', () => {
  const root = tempRoot('r2-counterexamples');
  try {
    // 1. Reference section slicing & 404 on missing section
    const refStore = new DomainReferenceStore(root, process.cwd());
    const docBody = [
      '# 会员资产参考模板',
      '引言第一段。',
      '## 第 1 节 身份去重',
      '品牌账号口径说明。',
      '## 第 2 节 观察窗与退款',
      '首购后 30 日观察窗，跨月全额退款需冲销。',
      '## 第 3 节 退订边界',
      '退订用户不得进入短信候选。',
    ].join('\n');
    const reg = refStore.register({
      sourceId: 'SYNTH-SEC-001',
      version: '0.1',
      title: '章节切片测试参考',
      domain: 'member',
      routes: ['domain'],
      maintainer: '测试维护',
      scope: '章节回读验证',
      evidenceNature: 'synthetic-fixture',
      locator: 'synthetic://sec.md',
      visibility: 'shared',
      contentBody: docBody,
    });
    const sec2 = refStore.readOriginal(reg.record.id, '第 2 节');
    assert.equal(sec2.isExcerpt, true);
    assert.ok(sec2.text.includes('观察窗与退款'));
    assert.ok(!sec2.text.includes('身份去重'));
    assert.ok(!sec2.text.includes('退订用户不得进入短信候选'));
    const lineSlice = refStore.readOriginal(reg.record.id, '3-4');
    assert.equal(lineSlice.isExcerpt, true);
    assert.equal(lineSlice.text, '## 第 1 节 身份去重\n品牌账号口径说明。');
    assert.throws(() => refStore.readOriginal(reg.record.id, '不存在的第 99 节'), /domain_reference_section_not_found/);

    // 2. Dual-route upsertEntry merges both routes' referenceLinks and enterpriseSourceRefs without overwriting!
    const packStore = new EnterprisePackStore(root);
    const entId = '11111111-1111-4111-8111-111111111111';
    const sysId = '22222222-2222-4222-8222-222222222222';
    const pack = packStore.ensurePack({ enterpriseId: entId, systemId: sysId, domain: 'member-operations', name: '反例校验包' });

    const srcA = { authority: 'data' as const, id: 'policy.md', version: '1', sha256: sha('policy'), title: '会员制度' };
    const srcB = { authority: 'data' as const, id: 'monthly.md', version: '1', sha256: sha('monthly'), title: '月报口径' };
    packStore.upsertEntry(pack.id, {
      entryKey: 'valid_purchase',
      title: '有效购买规则',
      action: 'modify',
      routes: ['enterprise'],
      referenceLinks: [{ refId: reg.record.id, sourceId: 'T03', version: '0.2', sectionLocator: '渠道', evidenceNature: 'public-benchmark' }],
      enterpriseBasis: '企业线依据：以制度实付成交为准',
      enterpriseSourceRefs: [srcA],
      scope: '直营门店',
      impactedPurposeIds: [],
      exceptions: [
        // Two exceptions overlapping in dates (Sep 2026) for DIFFERENT stores & DIFFERENT eventTypes -> MUST NOT conflict!
        { id: 'ex-star-coupon', replacesRuleKey: 'valid_purchase', eventType: 'coupon_rebate', scope: '星桥满减活动', storeIds: ['星桥直营店'], effectiveFrom: '2026-09-01', effectiveTo: '2026-09-30', approvalBasis: '审批1', approvedBy: '运营甲', status: 'approved' },
      ],
    });
    const afterSecondRoute = packStore.upsertEntry(pack.id, {
      entryKey: 'valid_purchase',
      title: '有效购买规则',
      action: 'modify',
      routes: ['domain'],
      referenceLinks: [{ refId: reg.record.id, sourceId: 'DAP-MEMBER-001', version: '0.1', sectionLocator: '第 2 节', evidenceNature: 'generic-draft' }],
      enterpriseBasis: '会员线依据：全额退款排除',
      enterpriseSourceRefs: [srcB],
      scope: '直营门店',
      impactedPurposeIds: [],
      exceptions: [
        { id: 'ex-willow-birthday', replacesRuleKey: 'valid_purchase', eventType: 'birthday_voucher', scope: '柳岸生日券试点', storeIds: ['柳岸直营店'], effectiveFrom: '2026-09-10', effectiveTo: '2026-09-25', approvalBasis: '审批2', approvedBy: '运营乙', status: 'approved' },
      ],
    });
    const mergedEntry = afterSecondRoute.entries.find(e => e.entryKey === 'valid_purchase')!;
    assert.deepEqual([...mergedEntry.routes].sort(), ['domain', 'enterprise']);
    assert.equal(mergedEntry.referenceLinks.length, 2, 'Route 2 update must preserve Route 1 referenceLinks');
    assert.equal(mergedEntry.enterpriseSourceRefs.length, 2, 'Route 2 update must preserve Route 1 enterpriseSourceRefs');
    assert.ok(mergedEntry.enterpriseBasis.includes('企业线依据') && mergedEntry.enterpriseBasis.includes('会员线依据'));
    assert.equal(mergedEntry.exceptions.length, 2);

    // 3. Calculation purpose missing history, sampleCalculation, or dependencies MUST NOT become eligible!
    const depRef = { authority: 'sap-metric' as const, id: 'repurchase', version: '1.0.0', sha256: sha('rep-1') };
    const noHistory = packStore.upsertPurpose(pack.id, {
      purposeKey: 'no-history', title: '缺首购历史复购', businessQuestion: '缺历史', subjectUnit: 'brand_account', windowDays: 30,
      scope: { scopeKey: 's1', stores: ['星桥直营店'] }, tier: 'formal-calculation', businessStatus: 'active',
      evidenceReadiness: { definition: 'pass', mapping: 'pass', sampleCalculation: 'pass' },
      originalGoal: 'g', completionCriteria: 'c', observationWindowDays: 30, /* availableHistoryDays omitted! */
      dependencies: [{ id: 'd1', role: 'sap-metric', authority: 'sap-metric', ref: depRef, requiredFor: ['formal-calculation'] }],
    });
    const noSample = packStore.upsertPurpose(pack.id, {
      purposeKey: 'no-sample', title: '缺样算复购', businessQuestion: '缺样算', subjectUnit: 'brand_account', windowDays: 30,
      scope: { scopeKey: 's2', stores: ['星桥直营店'] }, tier: 'formal-calculation', businessStatus: 'active',
      evidenceReadiness: { definition: 'pass', mapping: 'pass', sampleCalculation: 'pending' },
      originalGoal: 'g', completionCriteria: 'c', observationWindowDays: 30, availableHistoryDays: 60,
      dependencies: [{ id: 'd2', role: 'sap-metric', authority: 'sap-metric', ref: depRef, requiredFor: ['formal-calculation'] }],
    });
    const noDeps = packStore.upsertPurpose(pack.id, {
      purposeKey: 'no-deps', title: '缺依赖复购', businessQuestion: '缺依赖', subjectUnit: 'brand_account', windowDays: 30,
      scope: { scopeKey: 's3', stores: ['星桥直营店'] }, tier: 'formal-calculation', businessStatus: 'active',
      evidenceReadiness: { definition: 'pass', mapping: 'pass', sampleCalculation: 'pass' },
      originalGoal: 'g', completionCriteria: 'c', observationWindowDays: 30, availableHistoryDays: 60,
      dependencies: [],
    });
    const readyDistinctEx = packStore.upsertPurpose(pack.id, {
      purposeKey: 'ready-distinct-ex', title: '不同门店与事件例外不误判冲突', businessQuestion: '验证例外作用域', subjectUnit: 'brand_account', windowDays: 30,
      scope: { scopeKey: 's4', stores: ['星桥直营店', '柳岸直营店'] }, tier: 'formal-calculation', businessStatus: 'active',
      evidenceReadiness: { definition: 'pass', mapping: 'pass', sampleCalculation: 'pass' },
      originalGoal: 'g', completionCriteria: 'c', observationWindowDays: 30, availableHistoryDays: 60,
      dependencies: [{ id: 'd4', role: 'sap-metric', authority: 'sap-metric', ref: depRef, requiredFor: ['formal-calculation'] }],
      decisionChoices: [{ id: 'c1', question: '跨店归属', options: [{ key: 'first', label: '首购店', impact: '归首购' }] }],
    });

    // Unresolved decision or missing decider is rejected!
    assert.throws(() => packStore.preparePreview(pack.id, {
      version: '1.0', purposeIds: [readyDistinctEx.purpose.id], summary: '未选决定',
    }), /enterprise_pack_decision_required/);
    assert.throws(() => packStore.preparePreview(pack.id, {
      version: '1.0', purposeIds: [readyDistinctEx.purpose.id],
      decisions: [{ purposeId: readyDistinctEx.purpose.id, choiceId: 'c1', selectedKey: 'first' }],
      summary: '缺决定人',
    }), /enterprise_pack_decision_owner_required/);

    const preview = packStore.preparePreview(pack.id, {
      version: '1.0',
      purposeIds: [noHistory.purpose.id, noSample.purpose.id, noDeps.purpose.id, readyDistinctEx.purpose.id],
      decisions: [{ purposeId: readyDistinctEx.purpose.id, choiceId: 'c1', selectedKey: 'first', decidedBy: '实际负责人张三' }],
      dataCutoffAt: '2026-10-31',
      summary: '全反例预览',
    });
    assert.equal(preview.purposeSnapshots.find(p => p.purposeId === noHistory.purpose.id)!.status, 'restricted');
    assert.equal(preview.purposeSnapshots.find(p => p.purposeId === noSample.purpose.id)!.status, 'suspended');
    assert.equal(preview.purposeSnapshots.find(p => p.purposeId === noDeps.purpose.id)!.status, 'suspended');
    // Distinct store & distinct eventType overlapping-date exceptions MUST NOT falsely conflict!
    assert.equal(preview.purposeSnapshots.find(p => p.purposeId === readyDistinctEx.purpose.id)!.status, 'eligible');

    // Draft drift after preview MUST reject confirming the stale preview!
    packStore.upsertPurpose(pack.id, {
      purposeKey: 'ready-distinct-ex', title: '草案已变动的用途', businessQuestion: '验证漂移', subjectUnit: 'brand_account', windowDays: 30,
      scope: { scopeKey: 's4', stores: ['星桥直营店', '柳岸直营店'] }, tier: 'formal-calculation', businessStatus: 'active',
      evidenceReadiness: { definition: 'pass', mapping: 'pass', sampleCalculation: 'pass' },
      originalGoal: 'g', completionCriteria: 'c', observationWindowDays: 30, availableHistoryDays: 60,
      dependencies: [{ id: 'd4', role: 'sap-metric', authority: 'sap-metric', ref: depRef, requiredFor: ['formal-calculation'] }],
    });
    assert.throws(() => packStore.confirmPreview(pack.id, {
      previewId: preview.id,
      fingerprint: preview.fingerprint,
      moduleReceipts: [{ requestId: 'P-1', authority: 'sap-metric', targetRef: depRef, status: 'succeeded', detail: 'ok', purposeIds: [readyDistinctEx.purpose.id] }],
    }), /enterprise_pack_draft_changed/);

    // Fresh preview after drift confirms cleanly: only readyDistinctEx becomes eligible; noHistory/noSample/noDeps remain NOT eligible!
    const preview2 = packStore.preparePreview(pack.id, {
      version: '1.0',
      purposeIds: [noHistory.purpose.id, noSample.purpose.id, noDeps.purpose.id, readyDistinctEx.purpose.id],
      decisions: [{ purposeId: readyDistinctEx.purpose.id, choiceId: 'c1', selectedKey: 'first', decidedBy: '实际负责人张三' }],
      summary: '重新预览',
    });
    const rev = packStore.confirmPreview(pack.id, {
      previewId: preview2.id,
      fingerprint: preview2.fingerprint,
      moduleReceipts: [{ requestId: 'P-1', authority: 'sap-metric', targetRef: depRef, status: 'succeeded', detail: 'ok', purposeIds: [readyDistinctEx.purpose.id] }],
    });
    assert.equal(rev.purposeManifests.find(p => p.purposeId === noHistory.purpose.id)!.status, 'restricted');
    assert.equal(rev.purposeManifests.find(p => p.purposeId === noSample.purpose.id)!.status, 'suspended');
    assert.equal(rev.purposeManifests.find(p => p.purposeId === noDeps.purpose.id)!.status, 'suspended');
    assert.equal(rev.purposeManifests.find(p => p.purposeId === readyDistinctEx.purpose.id)!.status, 'eligible');

    // 4. All three stores enforce 503 member_pack_disabled_readonly when readOnlyMode: true!
    const roRefs = new DomainReferenceStore(root, process.cwd(), { readOnlyMode: true });
    const roGrants = new ResourceGrantStore(root, { readOnlyMode: true });
    const roPacks = new EnterprisePackStore(root, { readOnlyMode: true });
    assert.throws(() => roRefs.registerRepoTemplate('T03'), /member_pack_disabled_readonly/);
    assert.throws(() => roGrants.grant({
      enterpriseId: entId, grantor: 'h', grantBasis: 'b', subjectType: 'project', subjectId: sysId, resourceKind: 'definition', operations: ['read-definition'],
    }), /member_pack_disabled_readonly/);
    assert.throws(() => roPacks.ensurePack({ enterpriseId: entId, systemId: sysId, domain: 'member-operations', name: 'x' }), /member_pack_disabled_readonly/);
    // While reads remain intact
    assert.equal(roRefs.list().length, 1);
    assert.equal(roPacks.get(pack.id).packRevisions.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Round-3 counterexamples: selective republication carries over unchanged eligible purposes, frozen snapshot isolates historical reconcile from live draft drift, failed receipts cannot promote to succeeded, verifyUse requires complete requiredRefs reads + authorDeclaration, and verified feedback closure rejects same-task/same-version/unrevised-authority', () => {
  const root = tempRoot('r3-counterexamples');
  try {
    const store = new EnterprisePackStore(root);
    const entId = '11111111-1111-4111-8111-111111111111';
    const sysId = '22222222-2222-4222-8222-222222222222';
    const projA = '33333333-3333-4333-8333-333333333333';
    const taskA = '44444444-4444-4444-8444-444444444444';
    const taskB = '55555555-5555-4555-8555-555555555555';

    const pack = store.ensurePack({ enterpriseId: entId, systemId: sysId, domain: 'member-operations', name: 'R3 严格验证包' });
    const ruleRef = { authority: 'enterprise' as const, id: '66666666-6666-4666-8666-666666666666', version: 'r1', sha256: sha('rule-r1'), title: '会员有效购买口径' };
    const sapV1 = { authority: 'sap-metric' as const, id: 'repurchase', version: '1.0.0', sha256: sha('sap-v1'), title: '复购指标 v1' };
    const sapV2 = { authority: 'sap-metric' as const, id: 'repurchase', version: '1.1.0', sha256: sha('sap-v2'), title: '复购指标 v2' };
    const unrelatedRef = { authority: 'enterprise' as const, id: '77777777-7777-4777-8777-777777777777', version: 'r1', sha256: sha('unrelated'), title: '无关资料' };

    const defP = store.upsertPurpose(pack.id, {
      purposeKey: 'member-def-only',
      title: '独立定义用途',
      businessQuestion: '解释有效购买定义',
      subjectUnit: 'brand_account',
      windowDays: 30,
      scope: { scopeKey: 'def:all' },
      tier: 'definition-reference',
      businessStatus: 'active',
      evidenceReadiness: { definition: 'pass' },
      originalGoal: '口径定义',
      completionCriteria: '清晰可查',
      dependencies: [{ id: 'd-rule', role: 'member-rule', authority: 'enterprise', ref: ruleRef, requiredFor: ['definition-reference'] }],
    });
    const calcP = store.upsertPurpose(pack.id, {
      purposeKey: 'member-calc-main',
      title: '门店复购计算用途',
      businessQuestion: '计算复购率',
      subjectUnit: 'brand_account',
      windowDays: 30,
      scope: { scopeKey: 'calc:star' },
      tier: 'formal-calculation',
      businessStatus: 'active',
      evidenceReadiness: { definition: 'pass', mapping: 'pass', sampleCalculation: 'pass' },
      originalGoal: '门店复购计算',
      completionCriteria: '分子分母可核',
      observationWindowDays: 30,
      availableHistoryDays: 60,
      dependencies: [
        { id: 'd-rule-c', role: 'member-rule', authority: 'enterprise', ref: ruleRef, requiredFor: ['formal-calculation'] },
        { id: 'd-sap-c', role: 'sap-metric', authority: 'sap-metric', ref: sapV1, requiredFor: ['formal-calculation'] },
      ],
    });

    // R1.3: Publish v1.0 where calc SAP fails definitely -> failed receipt MUST NOT be promoted to succeeded via reconcile!
    const prev10 = store.preparePreview(pack.id, { version: '1.0', purposeIds: [defP.purpose.id, calcP.purpose.id], summary: 'v1.0 发布' });
    const rev10 = store.confirmPreview(pack.id, {
      previewId: prev10.id,
      fingerprint: prev10.fingerprint,
      moduleReceipts: [
        { requestId: 'REQ-RULE-1', authority: 'member-rule', targetRef: ruleRef, status: 'succeeded', detail: 'ok', purposeIds: [defP.purpose.id, calcP.purpose.id] },
        { requestId: 'REQ-SAP-FAIL', authority: 'sap-metric', targetRef: sapV1, status: 'failed', detail: '原 SAP 指标不存在', purposeIds: [calcP.purpose.id] },
      ],
    });
    assert.equal(rev10.purposeManifests.find(p => p.purposeId === defP.purpose.id)!.status, 'eligible');
    assert.equal(rev10.purposeManifests.find(p => p.purposeId === calcP.purpose.id)!.status, 'suspended');
    assert.throws(() => store.reconcileModuleReceipt(pack.id, '1.0', {
      requestId: 'REQ-SAP-FAIL',
      authority: 'sap-metric',
      targetRef: sapV1,
      status: 'succeeded',
      detail: '尝试将明确失败改写为成功',
      purposeIds: [calcP.purpose.id],
    }), /enterprise_pack_failed_receipt_not_reconcilable/);

    // R1.4 & R1.5: Republish ONLY calcP in v1.1 (with unknown SAP initially), THEN mutate live draft sampleCalculation='pending',
    // THEN reconcile v1.1 -> unchanged defP MUST be carried over as eligible (carriedOverFromVersion='1.0'),
    // AND frozen snapshot in v1.1 MUST allow calcP to recover to eligible despite later live draft edit!
    const prev11 = store.preparePreview(pack.id, { version: '1.1', previousVersion: '1.0', purposeIds: [calcP.purpose.id], summary: '仅重发计算用途 v1.1' });
    const rev11 = store.confirmPreview(pack.id, {
      previewId: prev11.id,
      fingerprint: prev11.fingerprint,
      moduleReceipts: [
        { requestId: 'REQ-RULE-2', authority: 'member-rule', targetRef: ruleRef, status: 'succeeded', detail: 'ok', purposeIds: [calcP.purpose.id] },
        { requestId: 'REQ-SAP-UNK', authority: 'sap-metric', targetRef: sapV1, status: 'unknown', detail: '超时未知', purposeIds: [calcP.purpose.id] },
      ],
    });
    const carriedDef = rev11.purposeManifests.find(p => p.purposeId === defP.purpose.id);
    assert.ok(carriedDef, 'Unchanged eligible defP MUST be carried over when only calcP is republished!');
    assert.equal(carriedDef.status, 'eligible');
    assert.equal(carriedDef.carriedOverFromVersion, '1.0');
    assert.equal(rev11.purposeManifests.find(p => p.purposeId === calcP.purpose.id)!.status, 'suspended');

    // Mutate live draft calcP AFTER publishing v1.1 (simulating ongoing future v1.2 draft editing)
    store.upsertPurpose(pack.id, {
      purposeKey: 'member-calc-main',
      title: '门店复购计算用途（下一版草案编辑中）',
      businessQuestion: '计算复购率',
      subjectUnit: 'brand_account',
      windowDays: 30,
      scope: { scopeKey: 'calc:star' },
      tier: 'formal-calculation',
      businessStatus: 'active',
      evidenceReadiness: { definition: 'pass', mapping: 'pass', sampleCalculation: 'pending' },
      originalGoal: '门店复购计算',
      completionCriteria: '分子分母可核',
      observationWindowDays: 30,
      availableHistoryDays: 10,
      dependencies: [
        { id: 'd-rule-c', role: 'member-rule', authority: 'enterprise', ref: ruleRef, requiredFor: ['formal-calculation'] },
        { id: 'd-sap-c', role: 'sap-metric', authority: 'sap-metric', ref: sapV2, requiredFor: ['formal-calculation'] },
      ],
    });
    const rec11 = store.reconcileModuleReceipt(pack.id, '1.1', {
      requestId: 'REQ-SAP-UNK',
      authority: 'sap-metric',
      targetRef: sapV1,
      status: 'succeeded',
      detail: '原请求核对已提交',
      authorityPublishedBy: `企业会员包:${pack.packCode}:${prev11.id}`,
      purposeIds: [calcP.purpose.id],
    });
    assert.equal(rec11.purposeManifests.find(p => p.purposeId === calcP.purpose.id)!.status, 'eligible', 'Historical reconcile MUST use frozen v1.1 snapshot, NOT live mutated draft!');
    assert.equal(rec11.purposeManifests.find(p => p.purposeId === defP.purpose.id)!.status, 'eligible');

    // R4.2: Strict evaluateUseVerdict checks (partial read, missing requiredRef, missing authorDeclaration -> pending; wrong version -> fail)
    const partialVerdict = evaluateUseVerdict({
      expectedRef: sapV1,
      requiredRefs: [ruleRef, sapV1],
      actualReads: [
        { ref: ruleRef, sha256: ruleRef.sha256, complete: true, readAt: new Date().toISOString() },
        { ref: sapV1, sha256: sapV1.sha256, complete: false, readAt: new Date().toISOString() },
      ],
      hasAuthorDeclaration: true,
      independentConfirmed: true,
    });
    assert.equal(partialVerdict.verdict, 'pending');

    const missingDeclVerdict = evaluateUseVerdict({
      expectedRef: sapV1,
      requiredRefs: [ruleRef, sapV1],
      actualReads: [
        { ref: ruleRef, sha256: ruleRef.sha256, complete: true, readAt: new Date().toISOString() },
        { ref: sapV1, sha256: sapV1.sha256, complete: true, readAt: new Date().toISOString() },
      ],
      hasAuthorDeclaration: false,
      independentConfirmed: true,
    });
    assert.equal(missingDeclVerdict.verdict, 'pending');

    const unrelatedOnlyVerdict = evaluateUseVerdict({
      expectedRef: sapV1,
      requiredRefs: [ruleRef, sapV1],
      actualReads: [{ ref: unrelatedRef, sha256: unrelatedRef.sha256, complete: true, readAt: new Date().toISOString() }],
      hasAuthorDeclaration: true,
      independentConfirmed: true,
    });
    assert.equal(unrelatedOnlyVerdict.verdict, 'pending');

    const wrongRequiredVerdict = evaluateUseVerdict({
      expectedRef: ruleRef,
      requiredRefs: [ruleRef, sapV2],
      actualReads: [
        { ref: ruleRef, sha256: ruleRef.sha256, complete: true, readAt: new Date().toISOString() },
        { ref: sapV1, sha256: sapV1.sha256, complete: true, readAt: new Date().toISOString() },
      ],
      hasAuthorDeclaration: true,
      declaredRefs: [ruleRef, sapV1],
      independentConfirmed: true,
    });
    assert.equal(wrongRequiredVerdict.verdict, 'fail');
    assert.equal(wrongRequiredVerdict.wrongVersionDetected, true);

    // R5.3: Strict feedback verified closure checks!
    const reportA = { authority: 'task' as const, id: taskA, projectId: projA, taskId: taskA, version: sha('repA'), sha256: sha('repA'), locator: '060_reports/a.json' };
    const useA = store.recordUse(pack.id, {
      projectId: projA,
      taskId: taskA,
      reportRef: reportA,
      packVersion: '1.1',
      purposeId: calcP.purpose.id,
      purposeKey: calcP.purpose.purposeKey,
      tier: 'formal-calculation',
      accessLevel: 'recalculate',
      catalogSupplied: { packVersion: '1.1', purposeIds: [calcP.purpose.id], assetRefs: [ruleRef, sapV1], suppliedAt: new Date().toISOString() },
      actualReads: [
        { ref: ruleRef, sha256: ruleRef.sha256, complete: true, readAt: new Date().toISOString() },
        { ref: sapV1, sha256: sapV1.sha256, complete: true, readAt: new Date().toISOString() },
      ],
      authorDeclaration: { declaredPurposeId: calcP.purpose.id, declaredRefs: [ruleRef, sapV1], summaryText: 'Task A 声明', declaredAt: new Date().toISOString() },
    });
    store.verifyUse(pack.id, useA.id, { verifierRole: '复核员', expectedRef: sapV1, independentConfirmed: true, verdictDetail: 'v1.1 pass' });

    const fb = store.submitFeedback(pack.id, {
      problemKey: 'sap-bug',
      packVersion: '1.1',
      purposeIds: [calcP.purpose.id],
      title: 'SAP 指标口径缺陷',
      category: 'sap_formula',
      targetAssetRef: sapV1,
      report: { projectId: projA, taskId: taskA, sessionId: 's1', messageId: 'm1', reportRef: reportA, adoptionBasis: 'verified_actual_read', usedPackVersion: '1.1', usedAssetRefs: [sapV1], evidenceNote: '发现缺陷' },
    }).feedback;

    // 1) Same task + same version MUST be rejected!
    assert.throws(() => store.handleFeedback(pack.id, fb.id, {
      status: 'verified', note: '试图同任务同版闭环', verifiedByUseId: useA.id,
    }), /feedback_verification_must_be_independent_task/);

    // 2) Independent taskB on SAME pack version 1.1 MUST be rejected!
    const reportB11 = { authority: 'task' as const, id: taskB, projectId: projA, taskId: taskB, version: sha('repB11'), sha256: sha('repB11'), locator: '060_reports/b11.json' };
    const useB11 = store.recordUse(pack.id, {
      projectId: projA,
      taskId: taskB,
      reportRef: reportB11,
      packVersion: '1.1',
      purposeId: calcP.purpose.id,
      purposeKey: calcP.purpose.purposeKey,
      tier: 'formal-calculation',
      accessLevel: 'recalculate',
      catalogSupplied: { packVersion: '1.1', purposeIds: [calcP.purpose.id], assetRefs: [ruleRef, sapV1], suppliedAt: new Date().toISOString() },
      actualReads: [
        { ref: ruleRef, sha256: ruleRef.sha256, complete: true, readAt: new Date().toISOString() },
        { ref: sapV1, sha256: sapV1.sha256, complete: true, readAt: new Date().toISOString() },
      ],
      authorDeclaration: { declaredPurposeId: calcP.purpose.id, declaredRefs: [ruleRef, sapV1], summaryText: 'Task B v1.1', declaredAt: new Date().toISOString() },
    });
    store.verifyUse(pack.id, useB11.id, { verifierRole: '复核员', expectedRef: sapV1, independentConfirmed: true, verdictDetail: 'v1.1 pass' });
    assert.throws(() => store.handleFeedback(pack.id, fb.id, {
      status: 'verified', note: '试图同版闭环', verifiedByUseId: useB11.id, revisedRef: sapV2, revisedPackVersion: '1.1',
    }), /feedback_verification_requires_new_pack_version/);

    // 3) Publish real v1.2 with revised sapV2 -> reject closing without revisedRef OR with unchanged sapV1, succeed ONLY with real sapV2 + complete read!
    store.upsertPurpose(pack.id, {
      purposeKey: 'member-calc-main',
      title: '门店复购计算用途',
      businessQuestion: '计算复购率',
      subjectUnit: 'brand_account',
      windowDays: 30,
      scope: { scopeKey: 'calc:star' },
      tier: 'formal-calculation',
      businessStatus: 'active',
      evidenceReadiness: { definition: 'pass', mapping: 'pass', sampleCalculation: 'pass' },
      originalGoal: '门店复购计算',
      completionCriteria: '分子分母可核',
      observationWindowDays: 30,
      availableHistoryDays: 60,
      dependencies: [
        { id: 'd-rule-c', role: 'member-rule', authority: 'enterprise', ref: ruleRef, requiredFor: ['formal-calculation'] },
        { id: 'd-sap-c', role: 'sap-metric', authority: 'sap-metric', ref: sapV2, requiredFor: ['formal-calculation'] },
      ],
    });
    const prev12 = store.preparePreview(pack.id, { version: '1.2', previousVersion: '1.1', purposeIds: [calcP.purpose.id], summary: '修订 SAP v2' });
    store.confirmPreview(pack.id, {
      previewId: prev12.id,
      fingerprint: prev12.fingerprint,
      moduleReceipts: [
        { requestId: 'REQ-RULE-3', authority: 'member-rule', targetRef: ruleRef, status: 'succeeded', detail: 'ok', purposeIds: [calcP.purpose.id] },
        { requestId: 'REQ-SAP-3', authority: 'sap-metric', targetRef: sapV2, status: 'succeeded', detail: 'ok', purposeIds: [calcP.purpose.id] },
      ],
    });

    const reportB12 = { authority: 'task' as const, id: taskB, projectId: projA, taskId: taskB, version: sha('repB12'), sha256: sha('repB12'), locator: '060_reports/b12.json' };
    const useB12 = store.recordUse(pack.id, {
      projectId: projA,
      taskId: taskB,
      reportRef: reportB12,
      packVersion: '1.2',
      purposeId: calcP.purpose.id,
      purposeKey: calcP.purpose.purposeKey,
      tier: 'formal-calculation',
      accessLevel: 'recalculate',
      catalogSupplied: { packVersion: '1.2', purposeIds: [calcP.purpose.id], assetRefs: [ruleRef, sapV2], suppliedAt: new Date().toISOString() },
      actualReads: [
        { ref: ruleRef, sha256: ruleRef.sha256, complete: true, readAt: new Date().toISOString() },
        { ref: sapV2, sha256: sapV2.sha256, complete: true, readAt: new Date().toISOString() },
      ],
      authorDeclaration: { declaredPurposeId: calcP.purpose.id, declaredRefs: [ruleRef, sapV2], summaryText: 'Task B v1.2', declaredAt: new Date().toISOString() },
    });
    store.verifyUse(pack.id, useB12.id, { verifierRole: '复核员', expectedRef: sapV2, independentConfirmed: true, verdictDetail: 'v1.2 pass' });

    // Same unchanged ref MUST fail!
    assert.throws(() => store.handleFeedback(pack.id, fb.id, {
      status: 'verified', note: '无修订版尝试闭环', verifiedByUseId: useB12.id, revisedRef: sapV1, revisedPackVersion: '1.2',
    }), /feedback_verification_requires_authority_revision/);

    // Missing itemVerification on calculation purpose MUST fail!
    assert.throws(() => store.handleFeedback(pack.id, fb.id, {
      status: 'verified', note: '缺少逐笔更正证据反例', verifiedByUseId: useB12.id, revisedRef: sapV2, revisedPackVersion: '1.2',
    }), /feedback_verification_missing_item_evidence/);

    // Real revisedRef sapV2 + independent taskB + new version 1.2 + complete read + itemVerification -> PASSES with non-empty authorityUpdates & itemVerification!
    const closed = store.handleFeedback(pack.id, fb.id, {
      status: 'verified',
      note: '独立任务核实修订版 v1.2 通过',
      verifiedByUseId: useB12.id,
      revisedRef: sapV2,
      revisedPackVersion: '1.2',
      itemVerification: {
        originalCutoffChecked: '2026-10-31',
        transactionAssociationNote: '原单与跨月退款单在截止日 2026-10-31 前可见，按原单冲销后逐笔核对',
        shouldChange: [{ itemId: 'C07', beforeValue: '计入复购（3/4）', afterValue: '排除复购（2/4）', ...sourceCustody(projA, fb.reports[0]!.taskId, taskB, 2) }],
        shouldRetain: [{ itemId: 'C13', unchangedValue: '仍计入有效复购', ...sourceCustody(projA, fb.reports[0]!.taskId, taskB, 3) }],
        caseDecisionsPreserved: true,
      },
    });
    assert.equal(closed.feedback.status, 'verified');
    assert.equal(closed.feedback.revisionLink?.fromPackVersion, '1.1');
    assert.equal(closed.feedback.revisionLink?.toPackVersion, '1.2');
    assert.equal(closed.feedback.revisionLink?.authorityUpdates.length, 1);
    assert.equal(closed.feedback.revisionLink?.authorityUpdates[0]?.toRef.version, '1.1.0');
    assert.equal(closed.feedback.revisionLink?.itemVerification?.shouldChange[0]?.itemId, 'C07');
    assert.equal(closed.feedback.revisionLink?.itemVerification?.shouldRetain[0]?.itemId, 'C13');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Round-4 counterexamples: unique version & previousVersion enforcement across two v1.0 previews, omitted allowedDataPaths denied, continuation upsert preserves stores/window/deps, and unrelated asset cannot close refund feedback', () => {
  const root = tempRoot('round4-counterexamples');
  try {
    const store = new EnterprisePackStore(root);
    const grants = new ResourceGrantStore(root);
    const enterpriseId = '11111111-1111-4111-8111-111111111111';
    const systemId = '22222222-2222-4222-8222-222222222222';
    const projA = '33333333-3333-4333-8333-333333333333';
    const taskA = '44444444-4444-4444-8444-444444444444';
    const taskB = '55555555-5555-4555-8555-555555555555';

    // R2: Detail grant WITHOUT allowedDataPaths MUST deny any queried dataPath (never silently allow!)
    grants.grant({
      enterpriseId,
      grantor: '原权责项目',
      grantBasis: '仅给门店未给路径白名单反例',
      subjectType: 'project',
      subjectId: projA,
      resourceKind: 'detail',
      purposeKeys: ['store-first-purchase-30d-repurchase'],
      operations: ['read-detail-recalculate'],
      scope: { brand: '岚线', stores: ['星桥直营店'], periodFrom: '2026-09-01', periodTo: '2026-10-31' },
    });
    const noPathsCheck = evaluateResourceAccess(grants.listForSubject(enterpriseId, projA), {
      operation: 'read-detail-recalculate',
      purposeKey: 'store-first-purchase-30d-repurchase',
      stores: ['星桥直营店'],
      dataPath: '020_clean/willowbank_orders.csv',
    });
    assert.equal(noPathsCheck.allowed, false);
    assert.equal(noPathsCheck.restrictionReason, 'detail_data_path_not_authorized');

    const pack = store.ensurePack({ enterpriseId, systemId, domain: 'member-operations', name: 'Round-4 校验包' });
    const refundV1 = { authority: 'sap-method' as const, id: 'refund-method', version: '1', sha256: sha('refund-v1'), title: '退款映射 v1' };
    const checkinV1 = { authority: 'sap-method' as const, id: 'checkin-method', version: '1', sha256: sha('checkin-v1'), title: '签到口径 v1' };

    const pMain = store.upsertPurpose(pack.id, {
      purposeKey: 'store-first-purchase-30d-repurchase',
      title: '门店首购后 30 日有效复购率',
      businessQuestion: '衡量星桥 30 日有效复购',
      subjectUnit: 'brand_account',
      windowDays: 30,
      scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店'], period: '2026-09', scopeKey: 'lanxian:star:30d' },
      tier: 'formal-calculation',
      businessStatus: 'active',
      evidenceReadiness: { definition: 'pass', mapping: 'pass', sampleCalculation: 'pass' },
      originalGoal: '衡量星桥 30 日有效复购',
      completionCriteria: '分子分母可核',
      observationWindowDays: 30,
      availableHistoryDays: 60,
      dependencies: [{ id: 'dep-ref', role: 'shared-asset', authority: 'sap-method', ref: refundV1, requiredFor: ['formal-calculation'] }],
      dataCutoffAt: '2026-10-31',
    });

    // R3: Continuation upsert from panorama omitting windowDays & stores MUST reuse pMain and preserve stores/windowDays/tier/dependencies!
    const pContinued = store.upsertPurpose(pack.id, {
      purposeKey: 'store-first-purchase-30d-repurchase',
      title: '门店首购后 30 日有效复购率',
      businessQuestion: '从全景续建同一用途',
      subjectUnit: 'brand_account',
      scope: { brand: '岚线', channel: '直营', period: '2026-09', scopeKey: 'lanxian:direct:2026-09:store-first-purchase-30d-repurchase' },
      tier: 'definition-reference',
      businessStatus: 'active',
      originalGoal: '全景续建',
      completionCriteria: '分子分母可核',
      dependencies: [],
    });
    assert.equal(pContinued.created, false, 'Continuation upsert MUST reuse existing purpose instead of duplicating!');
    assert.equal(pContinued.purpose.id, pMain.purpose.id);
    assert.equal(pContinued.purpose.windowDays, 30);
    assert.deepEqual(pContinued.purpose.scope.stores, ['星桥直营店']);
    assert.equal(pContinued.purpose.tier, 'formal-calculation');
    assert.equal(pContinued.purpose.dependencies.length, 1);

    // R1: Two previews prepared for the SAME version '1.0' with different cutoffs/summaries -> ONLY the first may confirm!
    const preview1a = store.preparePreview(pack.id, {
      version: '1.0',
      purposeIds: [pMain.purpose.id],
      dataCutoffAt: '2026-10-31',
      summary: 'v1.0 首份预览',
    });
    const preview1b = store.preparePreview(pack.id, {
      version: '1.0',
      purposeIds: [pMain.purpose.id],
      dataCutoffAt: '2026-11-15',
      summary: 'v1.0 冲突第二份预览',
    });
    store.confirmPreview(pack.id, {
      previewId: preview1a.id,
      fingerprint: preview1a.fingerprint,
      moduleReceipts: [{ requestId: 'R4-1', authority: 'shared-asset', targetRef: refundV1, status: 'succeeded', detail: 'ok', purposeIds: [pMain.purpose.id] }],
    });
    // Confirming the second v1.0 preview MUST fail with enterprise_pack_version_exists!
    assert.throws(() => store.validateConfirmPreconditions(pack.id, preview1b.id, preview1b.fingerprint), /enterprise_pack_version_exists/);
    assert.throws(() => store.confirmPreview(pack.id, {
      previewId: preview1b.id,
      fingerprint: preview1b.fingerprint,
      moduleReceipts: [{ requestId: 'R4-2', authority: 'shared-asset', targetRef: refundV1, status: 'succeeded', detail: 'ok', purposeIds: [pMain.purpose.id] }],
    }), /enterprise_pack_version_exists/);
    // Preparing another v1.0 preview OR wrong previousVersion MUST fail!
    assert.throws(() => store.preparePreview(pack.id, { version: '1.0', purposeIds: [pMain.purpose.id], summary: '重复 v1.0' }), /enterprise_pack_version_exists/);
    assert.throws(() => store.preparePreview(pack.id, { version: '1.1', previousVersion: '0.9', purposeIds: [pMain.purpose.id], summary: '错前驱版' }), /enterprise_pack_previous_version_mismatch/);

    // R5: Unrelated check-in method on a separate purpose in v1.1 MUST NEVER close refund feedback!
    const pCheckin = store.upsertPurpose(pack.id, {
      purposeKey: 'store-checkin-definition',
      title: '门店签到口径',
      businessQuestion: '签到定义',
      subjectUnit: 'brand_account',
      scope: { scopeKey: 'lanxian:checkin' },
      tier: 'definition-reference',
      businessStatus: 'active',
      originalGoal: '签到定义',
      completionCriteria: '可读',
      dependencies: [{ id: 'dep-checkin', role: 'sap-method', authority: 'sap-method', ref: checkinV1, requiredFor: ['definition-reference'] }],
    });
    const prev11 = store.preparePreview(pack.id, { version: '1.1', previousVersion: '1.0', purposeIds: [pCheckin.purpose.id], summary: '仅增签到口径，未改退款规则' });
    store.confirmPreview(pack.id, {
      previewId: prev11.id,
      fingerprint: prev11.fingerprint,
      moduleReceipts: [{ requestId: 'R4-3', authority: 'sap-method', targetRef: checkinV1, status: 'succeeded', detail: 'ok', purposeIds: [pCheckin.purpose.id] }],
    });

    const repA = { authority: 'task' as const, id: taskA, projectId: projA, taskId: taskA, version: sha('rep-a'), sha256: sha('rep-a'), locator: '060_reports/a.json' };
    const fbRefund = store.submitFeedback(pack.id, {
      problemKey: 'refund-missing-orig-order',
      packVersion: '1.0',
      purposeIds: [pMain.purpose.id],
      title: '跨月退款未连原单',
      category: 'shared_refund_mapping',
      targetAssetRef: refundV1,
      report: { projectId: projA, taskId: taskA, sessionId: 'sA', messageId: 'mA', reportRef: repA, adoptionBasis: 'verified_actual_read', usedPackVersion: '1.0', usedAssetRefs: [refundV1], evidenceNote: '退款未冲销' },
    }).feedback;

    const repB = { authority: 'task' as const, id: taskB, projectId: projA, taskId: taskB, version: sha('rep-b'), sha256: sha('rep-b'), locator: '060_reports/b.json' };
    const useCheckin = store.recordUse(pack.id, {
      projectId: projA,
      taskId: taskB,
      reportRef: repB,
      packVersion: '1.1',
      purposeId: pCheckin.purpose.id,
      purposeKey: pCheckin.purpose.purposeKey,
      tier: 'definition-reference',
      accessLevel: 'definition',
      catalogSupplied: { packVersion: '1.1', purposeIds: [pCheckin.purpose.id], assetRefs: [checkinV1], suppliedAt: new Date().toISOString() },
      actualReads: [{ ref: checkinV1, sha256: checkinV1.sha256, complete: true, readAt: new Date().toISOString() }],
      authorDeclaration: { declaredPurposeId: pCheckin.purpose.id, declaredRefs: [checkinV1], summaryText: '只读了签到方法', declaredAt: new Date().toISOString() },
    });
    store.verifyUse(pack.id, useCheckin.id, { verifierRole: '复核员', expectedRef: checkinV1, independentConfirmed: true, verdictDetail: '签到阅读通过' });

    // Attempting to close refund feedback using useCheckin + checkinV1 MUST throw!
    assert.throws(() => store.handleFeedback(pack.id, fbRefund.id, {
      status: 'verified',
      note: '试图用无关签到用途闭环退款反馈',
      verifiedByUseId: useCheckin.id,
      revisedRef: checkinV1,
      revisedPackVersion: '1.1',
    }), /feedback_verification_purpose_mismatch/);

    // Even if a use was recorded under pMain on v1.1 with checkinV1 as revisedRef, asset identity mismatch MUST throw!
    const useMainFake = store.recordUse(pack.id, {
      projectId: projA,
      taskId: taskB,
      reportRef: repB,
      packVersion: '1.1',
      purposeId: pMain.purpose.id,
      purposeKey: pMain.purpose.purposeKey,
      tier: 'formal-calculation',
      accessLevel: 'recalculate',
      catalogSupplied: { packVersion: '1.1', purposeIds: [pMain.purpose.id], assetRefs: [refundV1], suppliedAt: new Date().toISOString() },
      actualReads: [{ ref: refundV1, sha256: refundV1.sha256, complete: true, readAt: new Date().toISOString() }, { ref: checkinV1, sha256: checkinV1.sha256, complete: true, readAt: new Date().toISOString() }],
      authorDeclaration: { declaredPurposeId: pMain.purpose.id, declaredRefs: [refundV1], summaryText: '试图混用', declaredAt: new Date().toISOString() },
    });
    store.verifyUse(pack.id, useMainFake.id, { verifierRole: '复核员', expectedRef: refundV1, independentConfirmed: true, verdictDetail: 'ok' });
    assert.throws(() => store.handleFeedback(pack.id, fbRefund.id, {
      status: 'verified',
      note: '试图用签到方法冒充退款修订',
      verifiedByUseId: useMainFake.id,
      revisedRef: checkinV1,
      revisedPackVersion: '1.1',
    }), /feedback_verification_asset_identity_mismatch/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Round-5 counterexamples: multi-scope same purposeKey (杉岸直营 90日 + 湖庭直营 30日) continuation routes strictly to 湖庭 30日 without hijacking 杉岸 90日, and ambiguous continuation requires explicit targetPurposeId', () => {
  const root = tempRoot('round5-multiscope');
  try {
    const store = new EnterprisePackStore(root);
    const enterpriseId = '11111111-1111-4111-8111-111111111111';
    const systemId = '22222222-2222-4222-8222-222222222222';
    const pack = store.ensurePack({ enterpriseId, systemId, domain: 'member-operations', name: 'Round-5 多范围测试包' });

    const pShanan90 = store.upsertPurpose(pack.id, {
      purposeKey: 'store-first-purchase-repurchase',
      title: '杉岸直营店 90 日门店复购率',
      businessQuestion: '衡量杉岸直营店 90 日复购',
      subjectUnit: 'brand_account',
      windowDays: 90,
      scope: { brand: '织屿', channel: '直营', stores: ['杉岸直营店'], period: '2026-Q3', scopeKey: 'zhiyu:direct:shanan:90d' },
      tier: 'formal-calculation',
      businessStatus: 'active',
      originalGoal: '杉岸 90 日复购',
      completionCriteria: '杉岸 90 日可复算',
      dataCutoffAt: '2026-10-31',
    });
    const pHuting30 = store.upsertPurpose(pack.id, {
      purposeKey: 'store-first-purchase-repurchase',
      title: '湖庭直营店 30 日门店复购率',
      businessQuestion: '衡量湖庭直营店 30 日复购',
      subjectUnit: 'brand_account',
      windowDays: 30,
      scope: { brand: '织屿', channel: '直营', stores: ['湖庭直营店'], period: '2026-09', scopeKey: 'zhiyu:direct:huting:30d' },
      tier: 'limited-calculation',
      limitedCalculationName: '湖庭直营 30 日复购（受限试算版）',
      businessStatus: 'active',
      originalGoal: '湖庭 30 日复购',
      completionCriteria: '湖庭 30 日可复算',
      dataCutoffAt: '2026-10-31',
    });
    assert.notEqual(pShanan90.purpose.id, pHuting30.purpose.id);

    const currentPurposes = store.get(pack.id).purposes;
    // Exact Codex Round-4 counterexample: clicking 湖庭 30日 recommendation MUST match pHuting30, NEVER pShanan90!
    const matchHuting = matchPanoramaRecommendationPurposes(currentPurposes, {
      purposeKey: 'store-first-purchase-repurchase',
      title: '湖庭直营 30 日门店复购率',
      priorityReason: '湖庭新店 30 日复购观察',
      deliverableNow: '湖庭直营店 30 日受限计算',
      minimumEvidence: '湖庭 9 月订单明细',
      ownerRole: '会员运营负责人',
      completionCriteria: '输出湖庭 30 日分子分母',
    });
    assert.equal(matchHuting.ambiguous, false);
    assert.equal(matchHuting.matched?.id, pHuting30.purpose.id, 'MUST match 湖庭 30日 instead of hijacking 杉岸 90日!');

    // Generic ambiguous recommendation under same purposeKey MUST return ambiguous=true and NEVER pick candidates[0]!
    const matchAmbiguous = matchPanoramaRecommendationPurposes(currentPurposes, {
      purposeKey: 'store-first-purchase-repurchase',
      title: '直营门店复购率复盘',
      priorityReason: '对比直营门店复购表现',
      deliverableNow: '门店复购试算',
      minimumEvidence: '门店订单明细',
      ownerRole: '会员运营负责人',
      completionCriteria: '输出复购分子分母',
    });
    assert.equal(matchAmbiguous.ambiguous, true);
    assert.equal(matchAmbiguous.matched, undefined);
    assert.equal(matchAmbiguous.candidates.length, 2);

    // Store upsertPurpose omitting windowDays/stores when two scopes share purposeKey MUST throw 409 enterprise_pack_purpose_ambiguous!
    assert.throws(() => store.upsertPurpose(pack.id, {
      purposeKey: 'store-first-purchase-repurchase',
      title: '未指定范围续建反例',
      businessQuestion: '复购',
      subjectUnit: 'brand_account',
      scope: { brand: '织屿', channel: '直营', scopeKey: 'zhiyu:direct:generic' },
      tier: 'definition-reference',
      businessStatus: 'active',
      originalGoal: '续建',
      completionCriteria: '核对',
    }), /enterprise_pack_purpose_ambiguous/);

    // Explicit targetPurposeId updates ONLY 湖庭 30日 while leaving 杉岸 90日 completely untouched!
    const updatedHuting = store.upsertPurpose(pack.id, {
      targetPurposeId: pHuting30.purpose.id,
      purposeKey: 'store-first-purchase-repurchase',
      title: '湖庭直营店 30 日门店复购率',
      businessQuestion: '衡量湖庭直营店 30 日复购（续建更新）',
      subjectUnit: 'brand_account',
      windowDays: 30,
      scope: pHuting30.purpose.scope,
      tier: 'limited-calculation',
      limitedCalculationName: '湖庭直营 30 日复购（受限试算版）',
      businessStatus: 'active',
      originalGoal: '湖庭 30 日复购',
      completionCriteria: '湖庭 30 日可复算',
    });
    assert.equal(updatedHuting.created, false);
    assert.equal(updatedHuting.purpose.id, pHuting30.purpose.id);
    const afterPack = store.get(pack.id);
    assert.equal(afterPack.purposes.length, 2);
    const shananAfter = afterPack.purposes.find(p => p.id === pShanan90.purpose.id)!;
    assert.equal(shananAfter.windowDays, 90);
    assert.deepEqual(shananAfter.scope.stores, ['杉岸直营店']);
    assert.equal(shananAfter.businessQuestion, '衡量杉岸直营店 90 日复购');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Round-6 counterexamples: single-store recommendation MUST NOT expand into two-store or brand-wide superset (R3), dual-read with old-version declaration MUST FAIL (R4), and post-cutoff refund misclassified as mapping_correction MUST throw 409 (R5)', () => {
  const root = tempRoot('round6-counterexamples');
  try {
    const store = new EnterprisePackStore(root);
    const enterpriseId = '11111111-1111-4111-8111-111111111111';
    const systemId = '22222222-2222-4222-8222-222222222222';
    const pack = store.ensurePack({ enterpriseId, systemId, name: '织屿 R6 专项测试包' });

    // 1. R3: Two-store purpose (湖庭直营店 + 杉岸直营店, 30日) AND unscoped brand-wide 30日 purpose exist
    const twoStore = store.upsertPurpose(pack.id, {
      purposeKey: 'store-first-purchase-repurchase',
      title: '湖庭与杉岸两店 30 日门店复购率',
      businessQuestion: '衡量湖庭与杉岸两店 30 日复购',
      subjectUnit: 'brand_account',
      windowDays: 30,
      scope: { brand: '织屿', channel: '直营', stores: ['湖庭直营店', '杉岸直营店'], period: '2026-09', scopeKey: 'zhiyu:direct:huting-shanan:30d' },
      tier: 'limited-calculation',
      limitedCalculationName: '湖庭及杉岸两店30日复购率（试算版）',
      businessStatus: 'active',
      originalGoal: '两店 30 日复购',
      completionCriteria: '两店可复算',
      dataCutoffAt: '2026-10-31',
    });
    const brandWide = store.upsertPurpose(pack.id, {
      purposeKey: 'store-first-purchase-repurchase',
      title: '织屿全店 30 日门店复购率',
      businessQuestion: '衡量全店 30 日复购',
      subjectUnit: 'brand_account',
      windowDays: 30,
      scope: { brand: '织屿', channel: '直营', period: '2026-09', scopeKey: 'zhiyu:direct:all:30d' },
      tier: 'definition-reference',
      businessStatus: 'active',
      originalGoal: '全店口径',
      completionCriteria: '全店口径确认',
      dataCutoffAt: '2026-10-31',
    });

    const singleStoreRec = {
      purposeKey: 'store-first-purchase-repurchase',
      title: '湖庭单店 30 日门店复购率',
      priorityReason: '聚焦湖庭单店 30 日新客复购表现',
      deliverableNow: '湖庭单店 30 日复购试算',
      minimumEvidence: '湖庭 9 月订单明细',
      ownerRole: '会员运营负责人',
      completionCriteria: '输出湖庭单店 30 日分子分母',
    };

    // Against ONLY the two-store purpose: MUST NOT auto-match twoStore!
    const mTwoOnly = matchPanoramaRecommendationPurposes([twoStore.purpose], singleStoreRec);
    assert.equal(mTwoOnly.matched, undefined, 'Single-store 湖庭 30日 MUST NEVER expand into two-store 湖庭+杉岸 30日!');
    assert.equal(mTwoOnly.ambiguous, false);
    assert.equal(mTwoOnly.scopeConflictCandidates?.length, 1);

    // Against ONLY the brand-wide unscoped purpose: MUST NOT auto-match brandWide!
    const mBrandOnly = matchPanoramaRecommendationPurposes([brandWide.purpose], singleStoreRec);
    assert.equal(mBrandOnly.matched, undefined, 'Single-store 湖庭 30日 MUST NEVER expand into unscoped brand-wide 30日!');
    assert.equal(mBrandOnly.ambiguous, false);

    // Against BOTH two-store & brand-wide: MUST still NOT match either!
    const mBoth = matchPanoramaRecommendationPurposes([twoStore.purpose, brandWide.purpose], singleStoreRec);
    assert.equal(mBoth.matched, undefined);
    assert.equal(mBoth.ambiguous, false);

    // But a two-store recommendation (湖庭及杉岸两店 30 日) DOES exact-match twoStore!
    const mTwoExact = matchPanoramaRecommendationPurposes([twoStore.purpose, brandWide.purpose], {
      ...singleStoreRec,
      title: '湖庭与杉岸两店 30 日门店复购率',
      priorityReason: '两店合并复购观察',
      deliverableNow: '湖庭与杉岸两店 30 日复购试算',
      completionCriteria: '输出湖庭与杉岸两店 30 日分子分母',
    });
    assert.equal(mTwoExact.ambiguous, false);
    assert.equal(mTwoExact.matched?.id, twoStore.purpose.id);

    // 2. R4: Dual-read (session read BOTH v1 and v2) while report explicitly declared old v1 -> evaluateUseVerdict MUST FAIL!
    const v1Ref = { authority: 'sap-method' as const, id: 'refund-map', version: '1', sha256: '11'.repeat(32) };
    const v2Ref = { authority: 'sap-method' as const, id: 'refund-map', version: '2', sha256: '22'.repeat(32) };
    const dualReadOldAdopted = evaluateUseVerdict({
      expectedRef: v2Ref,
      requiredRefs: [v2Ref],
      actualReads: [
        { ref: v1Ref, complete: true, readAt: '2026-11-01T00:00:00Z' },
        { ref: v2Ref, complete: true, readAt: '2026-11-01T00:01:00Z' },
      ],
      declaredRefs: [v1Ref],
      hasAuthorDeclaration: true,
      independentConfirmed: true,
    });
    assert.equal(dualReadOldAdopted.verdict, 'fail', 'Dual-read where report explicitly adopted old v1 MUST return fail!');
    assert.equal(dualReadOldAdopted.wrongVersionDetected, true);

    // Dual-read where report explicitly declared NEW v2 -> passes when independentConfirmed is true!
    const dualReadNewAdopted = evaluateUseVerdict({
      expectedRef: v2Ref,
      requiredRefs: [v2Ref],
      actualReads: [
        { ref: v1Ref, complete: true, readAt: '2026-11-01T00:00:00Z' },
        { ref: v2Ref, complete: true, readAt: '2026-11-01T00:01:00Z' },
      ],
      declaredRefs: [v2Ref],
      hasAuthorDeclaration: true,
      independentConfirmed: true,
    });
    assert.equal(dualReadNewAdopted.verdict, 'pass');
    assert.equal(dualReadNewAdopted.wrongVersionDetected, false);

    // 3. R5: Post-cutoff refund (2026-11-05 > originalCutoff 2026-10-31) misclassified as mapping_correction MUST be rejected!
    const pCalc = store.upsertPurpose(pack.id, {
      purposeKey: 'r6-calc-closure',
      title: 'R6 退款复购核算',
      businessQuestion: '复购核算',
      subjectUnit: 'brand_account',
      windowDays: 30,
      scope: { brand: '织屿', channel: '直营', stores: ['湖庭直营店'], scopeKey: 'zhiyu:r6:calc' },
      tier: 'formal-calculation',
      businessStatus: 'active',
      evidenceReadiness: { definition: 'pass', mapping: 'pass', sampleCalculation: 'pass' },
      originalGoal: '核实跨月退款',
      completionCriteria: '复算核对',
      dataCutoffAt: '2026-10-31',
      dependencies: [{ id: 'd1', role: 'shared-asset', authority: 'sap-method', ref: v1Ref, requiredFor: ['formal-calculation'] }],
    }).purpose;
    const prev1 = store.preparePreview(pack.id, { version: '1.0', purposeIds: [pCalc.id], dataCutoffAt: '2026-10-31', summary: 'v1.0' });
    store.confirmPreview(pack.id, {
      previewId: prev1.id, fingerprint: prev1.fingerprint,
      moduleReceipts: [{ requestId: 'r1', authority: 'shared-asset', targetRef: v1Ref, status: 'succeeded', detail: 'ok', purposeIds: [pCalc.id] }],
    });
    store.upsertPurpose(pack.id, {
      targetPurposeId: pCalc.id,
      purposeKey: 'r6-calc-closure',
      title: 'R6 退款复购核算',
      businessQuestion: '复购核算',
      subjectUnit: 'brand_account',
      windowDays: 30,
      scope: { brand: '织屿', channel: '直营', stores: ['湖庭直营店'], scopeKey: 'zhiyu:r6:calc' },
      tier: 'formal-calculation',
      businessStatus: 'active',
      evidenceReadiness: { definition: 'pass', mapping: 'pass', sampleCalculation: 'pass' },
      originalGoal: '核实跨月退款',
      completionCriteria: '复算核对',
      dataCutoffAt: '2026-10-31',
      dependencies: [{ id: 'd1', role: 'shared-asset', authority: 'sap-method', ref: v2Ref, requiredFor: ['formal-calculation'] }],
    });
    const prev2 = store.preparePreview(pack.id, { version: '1.1', previousVersion: '1.0', purposeIds: [pCalc.id], dataCutoffAt: '2026-10-31', summary: 'v1.1' });
    store.confirmPreview(pack.id, {
      previewId: prev2.id, fingerprint: prev2.fingerprint,
      moduleReceipts: [{ requestId: 'r2', authority: 'shared-asset', targetRef: v2Ref, status: 'succeeded', detail: 'ok', purposeIds: [pCalc.id] }],
    });
    const projId = '33333333-3333-4333-8333-333333333333';
    const taskAId = '44444444-4444-4444-8444-444444444444';
    const taskBId = '55555555-5555-4555-8555-555555555555';
    store.pinTaskVersion(pack.id, { projectId: projId, taskId: taskBId, version: '1.1', authorizedScope: '湖庭直营店' });
    const useB = store.recordUse(pack.id, {
      projectId: projId, taskId: taskBId,
      reportRef: { authority: 'task', id: taskBId, projectId: projId, taskId: taskBId, version: 'b'.repeat(64), sha256: 'b'.repeat(64), locator: '060_reports/v1.1.json' },
      packVersion: '1.1', purposeId: pCalc.id, purposeKey: pCalc.purposeKey, tier: 'formal-calculation', accessLevel: 'recalculate',
      catalogSupplied: { packVersion: '1.1', purposeIds: [pCalc.id], assetRefs: [v2Ref], suppliedAt: '2026-11-01T00:00:00Z' },
      actualReads: [{ ref: v2Ref, complete: true, readAt: '2026-11-01T00:01:00Z' }],
      authorDeclaration: { declaredPurposeId: pCalc.id, declaredRefs: [v2Ref], summaryText: 'v1.1', declaredAt: '2026-11-01T00:02:00Z' },
    });
    store.verifyUse(pack.id, useB.id, { verifierRole: '独立核验', expectedRef: v2Ref, independentConfirmed: true });
    const fb = store.submitFeedback(pack.id, {
      problemKey: 'r6-refund-post-cutoff',
      packVersion: '1.0',
      purposeIds: [pCalc.id],
      title: '跨月退款核查',
      category: 'shared_refund_mapping',
      targetAssetRef: v1Ref,
      report: {
        projectId: projId, taskId: taskAId, sessionId: 's1', messageId: 'm1',
        reportRef: { authority: 'task', id: taskAId, projectId: projId, taskId: taskAId, version: 'a'.repeat(64), sha256: 'a'.repeat(64), locator: '060_reports/v1.0.json' },
        adoptionBasis: 'verified_actual_read', usedPackVersion: '1.0', usedAssetRefs: [v1Ref], taskCutoffAt: '2026-10-31', evidenceNote: 'C07',
      },
    }).feedback;
    assert.throws(() => store.handleFeedback(pack.id, fb.id, {
      status: 'verified',
      note: '把截止日后新退款误标成原规则口径错误反例',
      verifiedByUseId: useB.id,
      revisedRef: v2Ref,
      revisedPackVersion: '1.1',
      itemVerification: {
        originalCutoffChecked: '2026-10-31',
        transactionAssociationNote: '反例',
        shouldChange: [{
          itemId: 'C09',
          beforeValue: '计入复购',
          afterValue: '排除复购',
          originalOrderId: 'O-99',
          refundDate: '2026-11-05',
          classification: 'mapping_correction',
        }],
        shouldRetain: [{ itemId: 'C13', unchangedValue: '保留' }],
      },
    }), /feedback_verification_post_cutoff_misclassified/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Round-7 counterexamples: contradictory targetPurposeId refuses auto-match (R3), read-only old version stays pending without false fail (R4), and valid postCutoffNewEvents closes under newCutoffChecked while rejecting misclassified pre-cutoff items (R5)', () => {
  // 1. R3: Contradictory targetPurposeId pointing to two-store purpose on single-store recommendation MUST NOT auto-match!
  const twoStorePurpose: EnterprisePackPurpose = {
    id: 'U-TWO-STORE',
    dedupKey: 'ent|pack|store-first-purchase-30d-repurchase|brand_account|zhiyu:huting-shanan:30d|30',
    purposeKey: 'store-first-purchase-30d-repurchase',
    title: '湖庭与杉岸两店 30 日门店复购率',
    businessQuestion: '计算湖庭与杉岸两店 30 日复购率',
    subjectUnit: 'brand_account',
    windowDays: 30,
    scope: { scopeKey: 'zhiyu:huting-shanan:30d', brand: '织屿主品牌', channel: '直营门店', stores: ['湖庭直营店', '杉岸直营店'], period: '2026-H1' },
    tier: 'limited-calculation',
    businessStatus: 'active',
    evidenceReadiness: { definition: 'pass', mapping: 'pass', sampleCalculation: 'pass', independentUse: 'pending' },
    originalGoal: '两店 30 日复购率',
    remainingGaps: [],
    exclusions: [],
    completionCriteria: '两店复算通过',
    dependencies: [],
    decisionChoices: [],
    workItemStatus: 'draft',
    maintenanceTasks: [],
    evidenceNotes: [],
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  };
  const contradictoryRec: EnterprisePanoramaRecommendation = {
    purposeKey: 'store-first-purchase-30d-repurchase',
    targetPurposeId: twoStorePurpose.id,
    title: '湖庭单店 30 日门店复购率',
    priorityReason: '仅聚焦湖庭单店 30 日复购，不可扩大到两店',
    deliverableNow: '湖庭单店 30 日受限试算',
    minimumEvidence: '湖庭单店订单明细',
    ownerRole: '会员运营负责人',
    completionCriteria: '输出湖庭单店 30 日复购分子分母',
    selected: false,
  };
  const conflictMatch = matchPanoramaRecommendationPurposes([twoStorePurpose], contradictoryRec);
  assert.equal(conflictMatch.matched, undefined, 'Contradictory targetPurposeId MUST NOT auto-match two-store purpose!');
  assert.equal(conflictMatch.ambiguous, true, 'Contradictory targetPurposeId MUST require explicit user disambiguation!');
  assert.equal(conflictMatch.scopeConflictCandidates.length, 1);
  assert.ok(conflictMatch.conflictReason && conflictMatch.conflictReason.includes('门店范围不一致'), `Expected explicit conflictReason, got: ${conflictMatch.conflictReason}`);

  // Aligned targetPurposeId still matches cleanly
  const alignedRec: EnterprisePanoramaRecommendation = {
    purposeKey: 'store-first-purchase-30d-repurchase',
    targetPurposeId: twoStorePurpose.id,
    title: '湖庭与杉岸两店 30 日门店复购率',
    priorityReason: '续建两店 30 日复购',
    deliverableNow: '湖庭及杉岸两店 30 日复算',
    minimumEvidence: '两店订单明细',
    ownerRole: '会员运营负责人',
    completionCriteria: '两店复算通过',
    stores: ['湖庭直营店', '杉岸直营店'],
    windowDays: 30,
    selected: false,
  };
  const alignedMatch = matchPanoramaRecommendationPurposes([twoStorePurpose], alignedRec);
  assert.equal(alignedMatch.matched?.id, twoStorePurpose.id);
  assert.equal(alignedMatch.conflictReason, undefined);

  // 2. R4: Mere read/inspection of old version WITHOUT author declaration & WITHOUT verifier confirming wrong-version adoption MUST stay pending (NOT fail!)
  const v1Ref: StudioSourceRef = { authority: 'sap-method', id: 'refund-map', version: '1', sha256: '1'.repeat(64) };
  const v2Ref: StudioSourceRef = { authority: 'sap-method', id: 'refund-map', version: '2', sha256: '2'.repeat(64) };
  const inspectOldOnly = evaluateUseVerdict({
    expectedRef: v2Ref,
    requiredRefs: [v2Ref],
    actualReads: [{ ref: v1Ref, complete: true, readAt: '2026-11-01T00:01:00Z' }],
    hasAuthorDeclaration: false,
    independentConfirmed: false,
  });
  assert.equal(inspectOldOnly.verdict, 'pending', 'Mere inspection of old version without declaration MUST remain pending (not misclassified as adoption)!');
  assert.equal(inspectOldOnly.wrongVersionDetected, false);

  // A declaration on the report cannot attribute an incidental old read to the report.
  for (const declaredRefs of [[v2Ref], undefined]) {
    const unconfirmedAdoption = evaluateUseVerdict({
      requiredRefs: [v2Ref],
      actualReads: [{ ref: v1Ref, complete: true, readAt: '2026-11-01T00:01:00Z' }],
      hasAuthorDeclaration: true,
      declaredRefs,
      independentConfirmed: true,
    });
    assert.equal(unconfirmedAdoption.verdict, 'pending');
    assert.equal(unconfirmedAdoption.wrongVersionDetected, false);
  }

  // The authors explicitly declared old v1 as adopted for this report.
  const declaredOldOnly = evaluateUseVerdict({
    expectedRef: v2Ref,
    requiredRefs: [v2Ref],
    actualReads: [{ ref: v1Ref, complete: true, readAt: '2026-11-01T00:01:00Z' }],
    hasAuthorDeclaration: true,
    declaredRefs: [v1Ref],
    independentConfirmed: true,
  });
  assert.equal(declaredOldOnly.verdict, 'fail');
  assert.equal(declaredOldOnly.wrongVersionDetected, true);

  // When independent verifier confirms wrong-version adoption even without declaration -> FAIL
  const verifierConfirmedWrong = evaluateUseVerdict({
    expectedRef: v2Ref,
    requiredRefs: [v2Ref],
    actualReads: [{ ref: v1Ref, complete: true, readAt: '2026-11-01T00:01:00Z' }],
    hasAuthorDeclaration: false,
    independentConfirmed: false,
    wrongVersionConfirmedByVerifier: true,
  });
  assert.equal(verifierConfirmedWrong.verdict, 'fail');
  assert.equal(verifierConfirmedWrong.wrongVersionDetected, true);

  // 3. R5: Legitimate post-cutoff new-event refund closure under newCutoffChecked
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optracall-r7-store-'));
  try {
    const store = new EnterprisePackStore(root);
    const entId = '11111111-1111-4111-8111-111111111111';
    const sysId = '22222222-2222-4222-8222-222222222222';
    const projId = '33333333-3333-4333-8333-333333333333';
    const pack = store.ensurePack({ enterpriseId: entId, systemId: sysId, domain: 'member-operations', name: 'R7测试包' });
    const pCalc = store.upsertPurpose(pack.id, {
      purposeKey: 'store-repurchase', title: '湖庭30日复购率', businessQuestion: '计算复购率',
      subjectUnit: 'brand_account', scope: { scopeKey: 'huting:30d', stores: ['湖庭直营店'] }, windowDays: 30,
      tier: 'formal-calculation', businessStatus: 'active', originalGoal: '复购', completionCriteria: '核验',
      evidenceReadiness: { definition: 'pass', mapping: 'pass', sampleCalculation: 'pass' },
      dataCutoffAt: '2026-10-31',
      dependencies: [{ id: 'd1', role: 'shared-asset', authority: 'sap-method', ref: v1Ref, requiredFor: ['formal-calculation'] }],
    }).purpose;
    const prev1 = store.preparePreview(pack.id, { version: '1.0', purposeIds: [pCalc.id], decisions: [], summary: 'v1.0', dataCutoffAt: '2026-10-31' });
    store.confirmPreview(pack.id, { previewId: prev1.id, fingerprint: prev1.fingerprint, moduleReceipts: [{ requestId: 'r1', authority: 'sap-method', targetRef: v1Ref, status: 'succeeded', detail: 'ok', purposeIds: [pCalc.id] }] });
    store.upsertPurpose(pack.id, {
      targetPurposeId: pCalc.id,
      purposeKey: 'store-repurchase', title: '湖庭30日复购率', businessQuestion: '计算复购率',
      subjectUnit: 'brand_account', scope: { scopeKey: 'huting:30d', stores: ['湖庭直营店'] }, windowDays: 30,
      tier: 'formal-calculation', businessStatus: 'active', originalGoal: '复购', completionCriteria: '核验',
      evidenceReadiness: { definition: 'pass', mapping: 'pass', sampleCalculation: 'pass' },
      dataCutoffAt: '2026-11-15',
      dependencies: [{ id: 'd1', role: 'shared-asset', authority: 'sap-method', ref: v2Ref, requiredFor: ['formal-calculation'] }],
    });
    const prev2 = store.preparePreview(pack.id, { version: '1.1', previousVersion: '1.0', purposeIds: [pCalc.id], decisions: [], summary: 'v1.1', dataCutoffAt: '2026-11-15' });
    store.confirmPreview(pack.id, { previewId: prev2.id, fingerprint: prev2.fingerprint, moduleReceipts: [{ requestId: 'r2', authority: 'sap-method', targetRef: v2Ref, status: 'succeeded', detail: 'ok', purposeIds: [pCalc.id] }] });
    const taskAId = '44444444-4444-4444-8444-444444444444';
    const taskBId = '55555555-5555-4555-8555-555555555555';
    store.pinTaskVersion(pack.id, { projectId: projId, taskId: taskBId, version: '1.1', authorizedScope: '湖庭直营店' });
    const useB = store.recordUse(pack.id, {
      projectId: projId, taskId: taskBId,
      reportRef: { authority: 'task', id: taskBId, projectId: projId, taskId: taskBId, version: 'b'.repeat(64), sha256: 'b'.repeat(64), locator: '060_reports/v1.1.json' },
      packVersion: '1.1', purposeId: pCalc.id, purposeKey: pCalc.purposeKey, tier: 'formal-calculation', accessLevel: 'recalculate',
      catalogSupplied: { packVersion: '1.1', purposeIds: [pCalc.id], assetRefs: [v2Ref], suppliedAt: '2026-11-15T00:00:00Z' },
      actualReads: [{ ref: v2Ref, complete: true, readAt: '2026-11-15T00:01:00Z' }],
      authorDeclaration: { declaredPurposeId: pCalc.id, declaredRefs: [v2Ref], summaryText: 'v1.1', declaredAt: '2026-11-15T00:02:00Z' },
    });
    store.verifyUse(pack.id, useB.id, { verifierRole: '独立核验', expectedRef: v2Ref, independentConfirmed: true });
    const fb = store.submitFeedback(pack.id, {
      problemKey: 'r7-post-cutoff-legit',
      packVersion: '1.0',
      purposeIds: [pCalc.id],
      title: '新截止日下确认截止日后新退款并闭环',
      category: 'shared_refund_mapping',
      targetAssetRef: v1Ref,
      report: {
        projectId: projId, taskId: taskAId, sessionId: 's1', messageId: 'm1',
        reportRef: { authority: 'task', id: taskAId, projectId: projId, taskId: taskAId, version: 'a'.repeat(64), sha256: 'a'.repeat(64), locator: '060_reports/v1.0.json' },
        adoptionBasis: 'verified_actual_read', usedPackVersion: '1.0', usedAssetRefs: [v1Ref], taskCutoffAt: '2026-10-31', evidenceNote: 'C21',
      },
    }).feedback;

    // Missing newCutoffChecked MUST fail
    assert.throws(() => store.handleFeedback(pack.id, fb.id, {
      status: 'verified', note: '缺新截止日反例', verifiedByUseId: useB.id, revisedRef: v2Ref, revisedPackVersion: '1.1',
      itemVerification: {
        originalCutoffChecked: '2026-10-31',
        transactionAssociationNote: '反例',
        shouldChange: [],
        postCutoffNewEvents: [{ itemId: 'C21', originalOrderId: 'O-21', refundDate: '2026-11-05', beforeValue: '计入复购', afterValue: '新截止日后排除', classification: 'post_cutoff_new_event' }],
        shouldRetain: [{ itemId: 'C13', unchangedValue: '保留' }],
      },
    }), /feedback_verification_missing_new_cutoff/);

    // Pre-cutoff refund hidden in postCutoffNewEvents MUST fail
    assert.throws(() => store.handleFeedback(pack.id, fb.id, {
      status: 'verified', note: '截止日前退款伪装新事件反例', verifiedByUseId: useB.id, revisedRef: v2Ref, revisedPackVersion: '1.1',
      itemVerification: {
        originalCutoffChecked: '2026-10-31',
        newCutoffChecked: '2026-11-15',
        transactionAssociationNote: '反例',
        shouldChange: [],
        postCutoffNewEvents: [{ itemId: 'C07', originalOrderId: 'O-07', refundDate: '2026-10-20', beforeValue: '计入复购', afterValue: '排除', classification: 'post_cutoff_new_event' }],
        shouldRetain: [{ itemId: 'C13', unchangedValue: '保留' }],
      },
    }), /feedback_verification_pre_cutoff_misclassified/);

    // Legitimate postCutoffNewEvents under newCutoffChecked + shouldRetain MUST close as verified!
    const closed = store.handleFeedback(pack.id, fb.id, {
      status: 'verified',
      note: '原截止日 2026-10-31 后新发生退款 C21（2026-11-05）已在新截止日 2026-11-15 下按 post_cutoff_new_event 单独归类并结案',
      verifiedByUseId: useB.id,
      revisedRef: v2Ref,
      revisedPackVersion: '1.1',
      itemVerification: {
        originalCutoffChecked: '2026-10-31',
        newCutoffChecked: '2026-11-15',
        transactionAssociationNote: 'C21 关联原单 O-21，退款日 2026-11-05 晚于原截止日 2026-10-31，不归咎为原口径错误，在新截止日 2026-11-15 单独列明',
        shouldChange: [],
        postCutoffNewEvents: [{ itemId: 'C21', originalOrderId: 'O-21', refundDate: '2026-11-05', beforeValue: '10/31计入复购', afterValue: '11/15口径按新事件排除', classification: 'post_cutoff_new_event', ...sourceCustody(projId, fb.reports[0]!.taskId, useB.taskId, 4) }],
        shouldRetain: [{ itemId: 'C13', originalOrderId: 'O-13', unchangedValue: '保留有效复购', ...sourceCustody(projId, fb.reports[0]!.taskId, useB.taskId, 3) }],
      },
    });
    assert.equal(closed.feedback.status, 'verified');
    assert.equal(closed.feedback.revisionLink?.itemVerification?.newCutoffChecked, '2026-11-15');
    assert.equal(closed.feedback.revisionLink?.itemVerification?.postCutoffNewEvents?.length, 1);
    assert.equal(closed.feedback.revisionLink?.itemVerification?.postCutoffNewEvents?.[0]?.itemId, 'C21');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('purposeKeys wildcard * grants access to any purpose; empty purposeKeys means unrestricted (legacy); precise keys do not expand', () => {
  const root = tempRoot('purpose-wildcard');
  try {
    const grants = new ResourceGrantStore(root);
    const entId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const projW = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const projP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const projU = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const base = { enterpriseId: entId, grantor: 'owner', grantBasis: 'test', subjectType: 'project' as const, subjectId: projW, resourceKind: 'definition' as const, operations: ['read-definition' as const], scope: {} };
    const wildcard = grants.grant({ ...base, purposeKeys: ['*'], operations: ['read-definition', 'cite-summary'], resourceKind: 'summary', scope: { summaryAssetId: 'asset-1', summaryVersion: '1', summaryAuthority: 'studio-source', grain: 'store-month' }, resourceRef: { authority: 'studio-source', id: 'asset-1', version: '1' } });
    const precise = grants.grant({ ...base, subjectId: projP, purposeKeys: ['specific-purpose'], operations: ['read-definition'] });
    const unrestricted = grants.grant({ ...base, subjectId: projU, operations: ['read-definition'] });
    const all = grants.list(entId);
    const wGrant = all.find(g => g.id === wildcard.id)!;
    const pGrant = all.find(g => g.id === precise.id)!;
    const uGrant = all.find(g => g.id === unrestricted.id)!;
    assert.ok(evaluateResourceAccess([wGrant], { operation: 'read-definition', purposeKey: 'any-purpose-at-all' }).allowed, '* must match any purpose');
    assert.ok(evaluateResourceAccess([wGrant], { operation: 'cite-summary', purposeKey: 'another-purpose', grain: 'store-month', summaryVersion: '1' }).allowed, '* must match any purpose for summary');
    assert.ok(evaluateResourceAccess([pGrant], { operation: 'read-definition', purposeKey: 'specific-purpose' }).allowed, 'precise key matches');
    assert.equal(evaluateResourceAccess([pGrant], { operation: 'read-definition', purposeKey: 'other-purpose' }).allowed, false, 'precise key must not expand');
    assert.ok(evaluateResourceAccess([uGrant], { operation: 'read-definition', purposeKey: 'anything' }).allowed, 'empty purposeKeys means unrestricted (legacy)');
    assert.throws(() => grants.grant({ ...base, subjectId: projU, purposeKeys: [] }), /invalid_grant_purpose_keys/, 'explicit empty purposeKeys array must be rejected');
    assert.throws(() => grants.grant({ ...base, subjectId: projU, purposeKeys: null as unknown as string[] }), /invalid_grant_purpose_keys/, 'explicit null purposeKeys must be rejected');
    const brandGrant = grants.grant({ ...base, subjectId: projP, purposeKeys: ['brand-a-purpose'], operations: ['read-definition', 'cite-summary'], resourceKind: 'summary', scope: { brand: 'BrandA', summaryAssetId: 'asset-1', summaryVersion: '1', summaryAuthority: 'studio-source', grain: 'store-month' }, resourceRef: { authority: 'studio-source', id: 'asset-1', version: '1' } });
    const bGrant = grants.get(brandGrant.id);
    assert.ok(evaluateResourceAccess([bGrant], { operation: 'cite-summary', purposeKey: 'brand-a-purpose', brand: 'BrandA', grain: 'store-month', summaryVersion: '1' }).allowed, 'matching brand passes');
    assert.equal(evaluateResourceAccess([bGrant], { operation: 'cite-summary', purposeKey: 'brand-a-purpose', brand: 'DifferentBrand', grain: 'store-month', summaryVersion: '1' }).allowed, false, 'brand mismatch must deny');
    const periodGrant = grants.grant({ ...base, subjectId: projU, purposeKeys: ['*'], operations: ['read-definition', 'cite-summary'], resourceKind: 'summary', scope: { periodFrom: '2026-09-01', periodTo: '2026-09-15', summaryAssetId: 'asset-1', summaryVersion: '1', summaryAuthority: 'studio-source', grain: 'store-month' }, resourceRef: { authority: 'studio-source', id: 'asset-1', version: '1' } });
    const pGrant2 = grants.get(periodGrant.id);
    assert.equal(isPeriodCovered('2026-09', pGrant2.scope.periodFrom, pGrant2.scope.periodTo), false, 'half-month grant must not cover full September');
    assert.equal(isPeriodCovered('2026-09-01', pGrant2.scope.periodFrom, pGrant2.scope.periodTo), true, 'single day within grant passes');
    assert.equal(isSourcePeriodCovered('2026-08', '2026-09', '2026-08-01', '2026-08-31'), false, 'A grant for August cannot cover an August–September source');
    assert.equal(isSourcePeriodCovered('2026-08', '2026-09', '2026-08-01', '2026-09-30'), true);
    assert.equal(isSourcePeriodCovered('2026-09-15', '2026-09-15', '2026-09-15', '2026-09-15'), true);
    assert.equal(isSourcePeriodCovered('2026-09-15', '2026-09-15', '2026-09-01', '2026-09-30'), true);
    assert.equal(isSourcePeriodCovered(undefined, undefined, undefined, undefined), true, 'A qualified source with unknown dates remains available with an unrestricted grant');
    assert.equal(isSourcePeriodCovered(undefined, undefined, '2026-09-01', '2026-09-30'), false, 'Finite grants require dates from the source itself');
    assert.equal(isSourcePeriodCovered('2026-10', '2026-09', '2026-09-01', '2026-10-31'), false, 'Reversed source periods cannot qualify');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
