import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createHost } from '../src/host/server.ts';
import type { MemberPackHostOptions } from '../src/host/member-pack-host.ts';

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

async function startTestHost(
  root: string,
  opts: {
    memberPackEnabled?: boolean;
    memberPackPublishHook?: MemberPackHostOptions['publishAuthorityDependency'];
  } = {},
) {
  const uiPort = 4183;
  const host = createHost({
    cwd: process.cwd(),
    uiPorts: [uiPort],
    transportVersion: 'test',
    dataRoot: path.join(root, 'data'),
    projectsRoot: path.join(root, 'projects'),
    memberPackEnabled: opts.memberPackEnabled,
    memberPackPublishHook: opts.memberPackPublishHook,
  });
  await new Promise<void>(resolve => host.server.listen(0, '127.0.0.1', resolve));
  const addr = host.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const req = async <T = any>(pathname: string, method: 'GET' | 'POST' | 'PUT' = 'GET', body?: unknown) => {
    const res = await fetch(`${base}${pathname}`, {
      method,
      headers: { 'x-optracall-client': '1', 'content-type': 'application/json', origin: `http://127.0.0.1:${uiPort}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json: json as T };
  };
  return { host, base, req, close: async () => { await host.close(); } };
}

test('Host member operations pack Round-2: real authority verification (rejects nonexistent SAP + ignores forged receipts + read-only reconcile + draft drift), default-deny & Host-verified grants + immediate revocation, enterprise-scoped reference original & section slicing, omitted-projectId archive guard, and 3-store rollback read-only mode', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optracall-member-pack-host-'));
  let simulateUnknownSapOnce = false;
  const srv = await startTestHost(root, {
    memberPackPublishHook: async (_pack, _preview, dep) => {
      if (simulateUnknownSapOnce && dep.ref.authority === 'sap-metric') {
        simulateUnknownSapOnce = false;
        return { status: 'unknown', detail: '模拟原 SAP 发布网络超时，需只读回查原权威核对' };
      }
      return undefined as unknown as never;
    },
  });
  try {
    // 1. Register repo built-in Nike T03 & T04 + enterprise-scoped reference + section slicing
    const t03 = await srv.req('/api/studio/domain-references/repo-template', 'POST', { requestId: randomUUID(), templateId: 'T03' });
    assert.equal(t03.status, 200);
    assert.equal(t03.json.record.contentSha256, '8c64c78a30876c8607c5c32af78bed38e7b662b26354828dd3cd1097a15b4895');

    const t04 = await srv.req('/api/studio/domain-references/repo-template', 'POST', { requestId: randomUUID(), templateId: 'T04' });
    assert.equal(t04.status, 200);
    assert.equal(t04.json.record.contentSha256, '49a33bfc8f6be8d21df4b9a1140f1d966705c0554f83c03aefa1fb85a87200b7');

    // Original text readable for verified T03 + exact line range slicing + missing section 404
    const t03Orig = await srv.req(`/api/studio/domain-references/${t03.json.record.id}/original`);
    assert.equal(t03Orig.status, 200);
    assert.equal(t03Orig.json.sha256, '8c64c78a30876c8607c5c32af78bed38e7b662b26354828dd3cd1097a15b4895');
    assert.equal(t03Orig.json.isExcerpt, false);

    const t03Slice = await srv.req(`/api/studio/domain-references/${t03.json.record.id}/original?section=1-5`);
    assert.equal(t03Slice.status, 200);
    assert.equal(t03Slice.json.isExcerpt, true);
    assert.equal(t03Slice.json.lineRange.start, 1);
    assert.equal(t03Slice.json.lineRange.end, 5);
    assert.ok(t03Slice.json.lineRange.total > 5);
    assert.ok(t03Slice.json.text.split('\n').length <= 5);

    const t03Missing = await srv.req(`/api/studio/domain-references/${t03.json.record.id}/original?section=第999节不存在`);
    assert.equal(t03Missing.status, 404);

    // Create Enterprise & Projects
    const ent1 = await srv.req('/api/studio/enterprises', 'POST', { requestId: randomUUID(), name: '织屿服饰' });
    assert.equal(ent1.status, 201);
    const enterpriseId = ent1.json.id;

    const ent2 = await srv.req('/api/studio/enterprises', 'POST', { requestId: randomUUID(), name: '另一企业' });
    assert.equal(ent2.status, 201);

    const cfg = await srv.req('/api/configuration', 'PUT', {
      name: 'Member Pack Synthetic',
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1/v1',
      model: 'synthetic-member-pack',
      apiKey: 'synthetic-only',
    });
    assert.equal(cfg.status, 200);

    const createProj = async (name: string, eid: string) => {
      const p = await srv.req('/api/projects', 'POST', { name });
      assert.equal(p.status, 201);
      const assoc = await srv.req('/api/studio/enterprise-associations', 'POST', { requestId: randomUUID(), kind: 'project', entityId: p.json.project.id, enterpriseId: eid });
      assert.equal(assoc.status, 200);
      return p.json.project;
    };

    const projBuild = await createProj('会员资产建设', enterpriseId);
    const projStar = await createProj('星桥门店分析', enterpriseId);
    const projAud = await createProj('两店核算复查', enterpriseId);
    const projMerch = await createProj('商品部口径查看', enterpriseId);
    const projHQ = await createProj('总部月报汇总', enterpriseId);
    const projUngranted = await createProj('未授权分析项目', enterpriseId);
    const projOtherEnt = await createProj('其他企业项目', ent2.json.id);

    // Enterprise-scoped reference: readable by same-enterprise project, REJECTED (403) without enterprise or from foreign enterprise/project!
    const entRefRes = await srv.req('/api/studio/domain-references', 'POST', {
      requestId: randomUUID(),
      sourceId: 'ENT-ZHIYU-POLICY-001',
      version: '1.0',
      title: '织屿企业内部会员制度',
      domain: 'member',
      routes: ['enterprise'],
      maintainer: '织屿会员运营部',
      scope: '岚线直营门店',
      evidenceNature: 'enterprise-official',
      locator: 'synthetic://zhiyu-policy-v1.md',
      visibility: 'enterprise',
      enterpriseId,
      contentBody: '# 第一节 有效购买\n全额退款不计入。\n# 第二节 跨店归属\n归首购直营店。\n',
    });
    assert.equal(entRefRes.status, 200);
    const entRefId = entRefRes.json.record.id;
    assert.equal((await srv.req(`/api/studio/domain-references/${entRefId}/original`)).status, 403);
    assert.equal((await srv.req(`/api/studio/domain-references/${entRefId}/original?projectId=${projOtherEnt.id}`)).status, 403);
    const entRefRead = await srv.req(`/api/studio/domain-references/${entRefId}/original?projectId=${projBuild.id}&section=第二节`);
    assert.equal(entRefRead.status, 200);
    assert.equal(entRefRead.json.isExcerpt, true);
    assert.match(entRefRead.json.text, /归首购直营店/);

    // Put detail CSV files into analysis projects' 020_clean
    for (const p of [projStar, projAud, projMerch, projHQ]) {
      fs.writeFileSync(path.join(p.rootPath, '020_clean', 'starbridge_orders.csv'), 'account,date,amount\nC07,2026-09-02,500\n');
      fs.writeFileSync(path.join(p.rootPath, '020_clean', 'willowbank_orders.csv'), 'account,date,amount\nW01,2026-09-05,400\n');
    }

    // Create Studio System for projBuild
    const sysRes = await srv.req('/api/studio/systems', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      name: '织屿会员运营体系',
      projectId: projBuild.id,
      goal: '盘点并建设企业会员运营资产包',
      topicTitle: '会员运营',
    });
    assert.equal(sysRes.status, 201);
    const systemId = sysRes.json.system.id;

    // 2. Seed REAL original authorities (Enterprise Material + SAP Method + SAP 0.2 Metric YAML)
    const matMember = await srv.req('/api/enterprise-materials', 'POST', {
      title: '织屿会员有效购买口径 v1',
      body: '有效购买口径：单品牌会员账号口径，扣除全额退款订单，不含门店体验签到。',
    });
    assert.equal(matMember.status, 201);
    const matMemberEnabled = await srv.req(`/api/enterprise-materials/${matMember.json.material.id}/enable`, 'POST', {
      expectedVersion: matMember.json.material.version,
    });
    assert.equal(matMemberEnabled.status, 200);
    const memberMatRev = matMemberEnabled.json.material.revisions[0];
    assert.equal((await srv.req('/api/studio/enterprise-associations', 'POST', {
      requestId: randomUUID(), kind: 'asset', authority: 'enterprise', entityId: matMember.json.material.id, enterpriseId,
    })).status, 200);
    const memberRuleRef = {
      authority: 'enterprise' as const,
      id: matMember.json.material.id,
      version: memberMatRev.revisionId,
      sha256: memberMatRev.bodySha256,
      locator: matMemberEnabled.json.storeId,
      title: '织屿会员有效购买口径 v1',
    };

    const matSummary = await srv.req('/api/enterprise-materials', 'POST', {
      title: '总部月报门店复购汇总 2026-09',
      body: '星桥直营店 2026-09 汇总复购率 75%（分子 3，分母 4，总部经营分析中心核定）。',
    });
    assert.equal(matSummary.status, 201);
    const matSummaryEnabled = await srv.req(`/api/enterprise-materials/${matSummary.json.material.id}/enable`, 'POST', {
      expectedVersion: matSummary.json.material.version,
    });
    assert.equal(matSummaryEnabled.status, 200);
    const summaryMatRev = matSummaryEnabled.json.material.revisions[0];
    assert.equal((await srv.req('/api/studio/enterprise-associations', 'POST', {
      requestId: randomUUID(), kind: 'asset', authority: 'enterprise', entityId: matSummary.json.material.id, enterpriseId,
    })).status, 200);
    const realSummaryRef = {
      authority: 'enterprise' as const,
      id: matSummary.json.material.id,
      version: summaryMatRev.revisionId,
      sha256: summaryMatRev.bodySha256,
      locator: matSummaryEnabled.json.storeId,
      title: '总部月报门店复购汇总 2026-09',
    };

    // Real published SAP Method (shared refund mapping)
    const sapMethodCreate = await srv.req('/api/sap/methods', 'POST', {
      requestId: randomUUID(),
      title: '销售退款映射规则 v1',
      content: {
        conditions: '适用于岚线直营门店销售及退款明细',
        logic: '关联原单号冲销当月及跨月全额退款',
        judgment: '净有效订单数 > 0 视为有效购买',
        limits: '仅限有原始订单关联号的记录',
      },
      sources: [],
    });
    assert.equal(sapMethodCreate.status, 201);
    assert.equal((await srv.req(`/api/sap/methods/${sapMethodCreate.json.method.id}/publish`, 'POST', {
      requestId: randomUUID(),
      version: 1,
      expectedSha256: sapMethodCreate.json.version.contentSha256,
    })).status, 200);
    assert.equal((await srv.req('/api/studio/enterprise-associations', 'POST', {
      requestId: randomUUID(), kind: 'asset', authority: 'sap-method', entityId: sapMethodCreate.json.method.id, enterpriseId,
    })).status, 200);
    const refundMethodRef = {
      authority: 'sap-method' as const,
      id: sapMethodCreate.json.method.id,
      version: '1',
      sha256: sapMethodCreate.json.version.contentSha256,
      title: '销售退款映射规则 v1',
    };

    // Prepare real SAP 0.2 metric draft file (NOT YET PUBLISHED until after unknown->reconcile counterexample!)
    const rawSapYaml = fs.readFileSync(
      path.join(process.cwd(), 'extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml'),
      'utf8',
    ).replaceAll('reviewed_by: huangbo', 'reviewed_by: synthetic-reviewer');
    fs.writeFileSync(path.join(projBuild.rootPath, '020_clean', 'member-repurchase.sap.yaml'), rawSapYaml);

    // Ensure Enterprise Pack
    const packRes = await srv.req('/api/studio/enterprise-packs', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      systemId,
      domain: 'member-operations',
      name: '织屿服饰 · 会员运营资产包',
    });
    assert.equal(packRes.status, 200);
    const packId = packRes.json.pack.id;

    // Cross-enterprise isolation: projOtherEnt cannot read ent1 pack!
    assert.equal((await srv.req(`/api/studio/enterprise-packs/${packId}?projectId=${projOtherEnt.id}`)).status, 403);

    // 3. R1 COUNTEREXAMPLE: Nonexistent SAP metric version MUST fail in real authority and NEVER become eligible!
    const nonexistentSapRef = {
      authority: 'sap-metric' as const,
      id: 'NONEXISTENT-SAP-METRIC-999',
      version: '9.9.9',
      sha256: sha('nonexistent-sap'),
      title: '不存在的伪造指标',
    };
    const purposeBase = {
      purposeKey: 'store-first-purchase-30d-repurchase',
      title: '门店首购后 30 日有效复购率',
      businessQuestion: '哪些门店首购会员 30 日复购偏低？',
      subjectUnit: 'brand_account',
      windowDays: 30,
      scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店'], period: '2026-09', scopeKey: 'lanxian:direct:starbridge:2026-09' },
      tier: 'formal-calculation' as const,
      businessStatus: 'active' as const,
      originalGoal: '衡量星桥首购 30 日有效复购率',
      remainingGaps: [],
      exclusions: ['未成熟观察窗'],
      completionCriteria: '输出可复算分子分母',
      evidenceReadiness: { definition: 'pass' as const, mapping: 'pass' as const, sampleCalculation: 'pass' as const },
      policyEffectiveFrom: '2026-09-01',
      dataCutoffAt: '2026-10-31',
      observationWindowDays: 30,
      availableHistoryDays: 60,
      decisionChoices: [{
        id: 'cross-store-scope',
        question: '跨店再购是否计入首购店复购？',
        options: [
          { key: 'any-direct', label: '任一获准直营店再购计入', impact: '衡量首购店获客持续购买' },
          { key: 'same-store', label: '仅回原店计入', impact: '衡量单店复购' },
        ],
      }],
    };

    // Concurrent purpose creation from two projects deduplicates into ONE purpose
    const [cp1, cp2] = await Promise.all([
      srv.req(`/api/studio/enterprise-packs/${packId}/purposes`, 'POST', {
        requestId: randomUUID(), projectId: projBuild.id, ...purposeBase,
        dependencies: [
          { id: 'dep-m', role: 'member-rule', authority: 'enterprise', ref: memberRuleRef, requiredFor: ['definition-reference', 'formal-calculation'] },
          { id: 'dep-fake-sap', role: 'sap-metric', authority: 'sap-metric', ref: nonexistentSapRef, requiredFor: ['formal-calculation'] },
        ],
      }),
      srv.req(`/api/studio/enterprise-packs/${packId}/purposes`, 'POST', {
        requestId: randomUUID(), projectId: projAud.id, ...purposeBase,
        dependencies: [
          { id: 'dep-m', role: 'member-rule', authority: 'enterprise', ref: memberRuleRef, requiredFor: ['definition-reference', 'formal-calculation'] },
          { id: 'dep-fake-sap', role: 'sap-metric', authority: 'sap-metric', ref: nonexistentSapRef, requiredFor: ['formal-calculation'] },
        ],
      }),
    ]);
    assert.equal(cp1.status, 200);
    assert.equal(cp2.status, 200);
    assert.equal(cp1.json.purpose.id, cp2.json.purpose.id);
    const calcPurposeId = cp1.json.purpose.id;

    // Independent definition-reference purpose backed by REAL enabled enterprise material
    const defPurpose = await srv.req(`/api/studio/enterprise-packs/${packId}/purposes`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      purposeKey: 'store-first-purchase-30d-repurchase-def',
      title: '门店复购口径定义',
      businessQuestion: '解释门店首购后 30 日有效复购率口径',
      subjectUnit: 'brand_account',
      windowDays: 30,
      scope: { brand: '岚线', channel: '直营', scopeKey: 'lanxian:direct:all' },
      tier: 'definition-reference',
      businessStatus: 'active',
      originalGoal: '供定义参考',
      remainingGaps: [],
      exclusions: [],
      completionCriteria: '明确定义与跨店归属',
      evidenceReadiness: { definition: 'pass' as const },
      dependencies: [{ id: 'dep-m-def', role: 'member-rule', authority: 'enterprise', ref: memberRuleRef, requiredFor: ['definition-reference'] }],
      policyEffectiveFrom: '2026-09-01',
      dataCutoffAt: '2026-10-31',
    });
    assert.equal(defPurpose.status, 200);
    const defPurposeId = defPurpose.json.purpose.id;

    // Preview v1.0 requires explicit decision + explicit decider
    const missingDeciderPrev = await srv.req(`/api/studio/enterprise-packs/${packId}/previews`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      version: '1.0',
      purposeIds: [defPurposeId, calcPurposeId],
      decisions: [{ purposeId: calcPurposeId, choiceId: 'cross-store-scope', selectedKey: 'any-direct' }],
      policyEffectiveFrom: '2026-09-01',
      dataCutoffAt: '2026-10-31',
      summary: '缺少确认人测试',
    });
    assert.equal(missingDeciderPrev.status, 409);

    const prevFake = await srv.req(`/api/studio/enterprise-packs/${packId}/previews`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      version: '1.0',
      purposeIds: [defPurposeId, calcPurposeId],
      decisions: [{ purposeId: calcPurposeId, choiceId: 'cross-store-scope', selectedKey: 'any-direct', decidedBy: '会员运营负责人' }],
      policyEffectiveFrom: '2026-09-01',
      dataCutoffAt: '2026-10-31',
      summary: '包含不存在 SAP 指标的反例预览',
    });
    assert.equal(prevFake.status, 200);

    // Even if client tries to forge moduleReceipts with status='succeeded', Host MUST ignore it and verify real SAP!
    const confFake = await srv.req(`/api/studio/enterprise-packs/${packId}/confirm`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      previewId: prevFake.json.preview.id,
      fingerprint: prevFake.json.preview.fingerprint,
      confirmedBy: '会员运营负责人',
      moduleReceipts: [
        { requestId: 'FORGED-1', authority: 'sap-metric', targetRef: nonexistentSapRef, status: 'succeeded', detail: '伪造成功', purposeIds: [calcPurposeId] },
      ],
    });
    assert.equal(confFake.status, 200);
    const fakeSapReceipt = confFake.json.revision.moduleReceipts.find((r: any) => r.targetRef.id === 'NONEXISTENT-SAP-METRIC-999');
    assert.equal(fakeSapReceipt.status, 'failed', 'Nonexistent SAP metric MUST return failed receipt, NEVER succeeded!');
    assert.equal(confFake.json.revision.purposeManifests.find((p: any) => p.purposeId === calcPurposeId).status, 'suspended');
    assert.equal(confFake.json.revision.purposeManifests.find((p: any) => p.purposeId === defPurposeId).status, 'eligible');

    // Reconcile even with client-forged status='succeeded' STILL checks real SAP read-only and stays failed/suspended!
    const recFake = await srv.req(`/api/studio/enterprise-packs/${packId}/reconcile`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      version: '1.0',
      targetRequestId: fakeSapReceipt.requestId,
      receipt: { requestId: fakeSapReceipt.requestId, status: 'succeeded', detail: '客户端伪造核对成功' },
    });
    assert.equal(recFake.status, 200);
    assert.equal(recFake.json.revision.purposeManifests.find((p: any) => p.purposeId === calcPurposeId).status, 'suspended');
    assert.equal(recFake.json.revision.moduleReceipts.at(-1).status, 'failed');

    // 4. Draft drift rejection + Real SAP publish with simulated 'unknown' -> read-only reconcile recovery!
    const realSapRef = {
      authority: 'sap-metric' as const,
      id: 'membership-repurchase',
      version: '1.0.0',
      title: '会员复购率 1.0.0',
    };
    await srv.req(`/api/studio/enterprise-packs/${packId}/purposes`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      ...purposeBase,
      dependencies: [
        { id: 'dep-r', role: 'shared-asset', authority: 'sap-method', ref: refundMethodRef, requiredFor: ['formal-calculation'] },
        { id: 'dep-m', role: 'member-rule', authority: 'enterprise', ref: memberRuleRef, requiredFor: ['definition-reference', 'formal-calculation'] },
        { id: 'dep-s', role: 'sap-metric', authority: 'sap-metric', ref: realSapRef, requiredFor: ['formal-calculation'] },
      ],
    });

    // Prepare preview v1.1, then mutate purpose -> confirm MUST reject 409 enterprise_pack_draft_changed!
    const stalePrev = await srv.req(`/api/studio/enterprise-packs/${packId}/previews`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      version: '1.1',
      previousVersion: '1.0',
      purposeIds: [defPurposeId, calcPurposeId],
      decisions: [{ purposeId: calcPurposeId, choiceId: 'cross-store-scope', selectedKey: 'any-direct', decidedBy: '会员运营负责人' }],
      policyEffectiveFrom: '2026-09-01',
      dataCutoffAt: '2026-10-31',
      summary: '草案漂移测试预览',
    });
    assert.equal(stalePrev.status, 200);
    await srv.req(`/api/studio/enterprise-packs/${packId}/purposes`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      ...purposeBase,
      completionCriteria: '草案变更后的完成标准',
      dependencies: [
        { id: 'dep-r', role: 'shared-asset', authority: 'sap-method', ref: refundMethodRef, requiredFor: ['formal-calculation'] },
        { id: 'dep-m', role: 'member-rule', authority: 'enterprise', ref: memberRuleRef, requiredFor: ['definition-reference', 'formal-calculation'] },
        { id: 'dep-s', role: 'sap-metric', authority: 'sap-metric', ref: realSapRef, requiredFor: ['formal-calculation'] },
      ],
    });
    const driftConfirm = await srv.req(`/api/studio/enterprise-packs/${packId}/confirm`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      previewId: stalePrev.json.preview.id,
      fingerprint: stalePrev.json.preview.fingerprint,
      confirmedBy: '会员运营负责人',
    });
    assert.equal(driftConfirm.status, 409);
    assert.equal(driftConfirm.json.code, 'enterprise_pack_draft_changed');

    // Fresh preview v1.1 + confirm where SAP returns real 'unknown' (not yet published in SAP MetricLibrary)
    const freshPrev = await srv.req(`/api/studio/enterprise-packs/${packId}/previews`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      version: '1.1',
      previousVersion: '1.0',
      purposeIds: [defPurposeId, calcPurposeId],
      decisions: [{ purposeId: calcPurposeId, choiceId: 'cross-store-scope', selectedKey: 'any-direct', decidedBy: '会员运营负责人' }],
      policyEffectiveFrom: '2026-09-01',
      dataCutoffAt: '2026-10-31',
      summary: '正式发布 v1.1（SAP 首次模拟未知）',
    });
    assert.equal(freshPrev.status, 200);
    simulateUnknownSapOnce = true;
    const confUnknown = await srv.req(`/api/studio/enterprise-packs/${packId}/confirm`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      previewId: freshPrev.json.preview.id,
      fingerprint: freshPrev.json.preview.fingerprint,
      confirmedBy: '会员运营负责人',
    });
    assert.equal(confUnknown.status, 200);
    const unknownSapReceipt = confUnknown.json.revision.moduleReceipts.find((r: any) => r.targetRef.id === 'membership-repurchase');
    assert.equal(unknownSapReceipt.status, 'unknown');
    assert.equal(confUnknown.json.revision.purposeManifests.find((p: any) => p.purposeId === calcPurposeId).status, 'suspended');
    assert.equal(confUnknown.json.revision.purposeManifests.find((p: any) => p.purposeId === defPurposeId).status, 'eligible');

    // Reconcile BEFORE real SAP publication MUST NOT recover to succeeded
    const recBeforePub = await srv.req(`/api/studio/enterprise-packs/${packId}/reconcile`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      version: '1.1',
      targetRequestId: unknownSapReceipt.requestId,
    });
    assert.equal(recBeforePub.status, 200);
    assert.equal(recBeforePub.json.revision.purposeManifests.find((p: any) => p.purposeId === calcPurposeId).status, 'suspended');

    // Now ACTUALLY publish membership-repurchase@1.0.0 in real MetricLibrary!
    const sapValidate = await srv.req('/api/metric-factory/draft/validate', 'POST', {
      projectId: projBuild.id,
      path: '020_clean/member-repurchase.sap.yaml',
    });
    assert.equal(sapValidate.status, 200);
    const sapPub = await srv.req('/api/metric-factory/publish', 'POST', {
      projectId: projBuild.id,
      path: '020_clean/member-repurchase.sap.yaml',
      publishedBy: 'synthetic-reviewer',
      expectedPackageFingerprint: sapValidate.json.packageFingerprint,
    });
    assert.equal(sapPub.status, 201);

    // Now read-only reconcile queries REAL MetricLibrary, confirms exact published version, preserves old unknown receipt, and promotes calc purpose to eligible!
    const recAfterPub = await srv.req(`/api/studio/enterprise-packs/${packId}/reconcile`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      version: '1.1',
      targetRequestId: unknownSapReceipt.requestId,
    });
    assert.equal(recAfterPub.status, 200);
    assert.equal(recAfterPub.json.revision.purposeManifests.find((p: any) => p.purposeId === calcPurposeId).status, 'eligible');
    assert.ok(recAfterPub.json.revision.moduleReceipts.some((r: any) => r.receiptId === unknownSapReceipt.receiptId && r.status === 'unknown'));
    assert.equal(recAfterPub.json.revision.moduleReceipts.at(-1).status, 'succeeded');

    // 5. R2: Default-deny on ungranted same-enterprise project + Host-verified grantor & summary authority + immediate revocation!
    const ungrantedPackView = await srv.req(`/api/studio/enterprise-packs/${packId}?projectId=${projUngranted.id}`);
    assert.equal(ungrantedPackView.status, 200);
    assert.deepEqual(ungrantedPackView.json.pack.purposes, []);
    assert.deepEqual(ungrantedPackView.json.pack.entries, []);

    // Forged/nonexistent summary asset MUST be rejected!
    const badSummaryGrant = await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      grantor: '伪造授权人',
      grantBasis: '尝试授权不存在汇总',
      subjectType: 'project',
      subjectId: projHQ.id,
      resourceKind: 'summary',
      purposeKeys: ['store-first-purchase-30d-repurchase'],
      operations: ['read-definition', 'cite-summary'],
      scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店'], periodFrom: '2026-09-01', periodTo: '2026-09-30', grain: 'store-month', summaryAssetId: randomUUID(), summaryVersion: '1' },
    });
    assert.equal(badSummaryGrant.status, 404);

    // Real verified summary grant: Host overrides spoofed grantor and binds grantorVerifiedBy='host' + real summarySha256!
    const goodSummaryGrant = await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      grantor: '伪造授权人',
      grantBasis: '总部月报引用核定汇总',
      subjectType: 'project',
      subjectId: projHQ.id,
      resourceKind: 'summary',
      resourceRef: realSummaryRef,
      purposeKeys: ['store-first-purchase-30d-repurchase'],
      operations: ['read-definition', 'cite-summary'],
      scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店'], periodFrom: '2026-09-01', periodTo: '2026-09-30', grain: 'store-month', summaryAssetId: realSummaryRef.id, summaryVersion: realSummaryRef.version },
    });
    assert.equal(goodSummaryGrant.status, 200);
    assert.equal(goodSummaryGrant.json.grant.grantorVerifiedBy, 'host');
    assert.notEqual(goodSummaryGrant.json.grant.grantor, '伪造授权人');
    assert.equal(goodSummaryGrant.json.grant.scope.summarySha256, realSummaryRef.sha256);

    await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      grantor: '企业资料原权责方',
      grantBasis: '商品部定义查阅',
      subjectType: 'project',
      subjectId: projMerch.id,
      resourceKind: 'definition',
      purposeKeys: ['store-first-purchase-30d-repurchase', 'store-first-purchase-30d-repurchase-def'],
      operations: ['read-definition'],
      scope: { brand: '岚线', channel: '直营' },
    });
    const starGrantRes = await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      grantor: '企业资料原权责方',
      grantBasis: '星桥店长仅读本店订单',
      subjectType: 'project',
      subjectId: projStar.id,
      resourceKind: 'detail',
      purposeKeys: ['store-first-purchase-30d-repurchase'],
      operations: ['read-definition', 'read-detail-recalculate'],
      scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店'], allowedDataPaths: ['020_clean/starbridge_orders.csv'] },
    });
    assert.equal(starGrantRes.status, 200);
    const starGrantId = starGrantRes.json.grant.id;

    await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      grantor: '企业资料原权责方',
      grantBasis: '两店核算岗跨店复算',
      subjectType: 'project',
      subjectId: projAud.id,
      resourceKind: 'detail',
      purposeKeys: ['store-first-purchase-30d-repurchase'],
      operations: ['read-definition', 'read-detail-recalculate'],
      scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店', '柳岸直营店'], allowedDataPaths: ['020_clean/starbridge_orders.csv', '020_clean/willowbank_orders.csv'] },
    });

    // Host evaluation & /api/studio/materials file boundary enforcement
    const evalStarOwn = await srv.req('/api/studio/resource-grants/evaluate', 'POST', {
      enterpriseId, subjectId: projStar.id, operation: 'read-detail-recalculate', purposeKey: 'store-first-purchase-30d-repurchase', stores: ['星桥直营店'], dataPath: '020_clean/starbridge_orders.csv',
    });
    assert.equal(evalStarOwn.json.evaluation.allowed, true);
    const evalStarOther = await srv.req('/api/studio/resource-grants/evaluate', 'POST', {
      enterpriseId, subjectId: projStar.id, operation: 'read-detail-recalculate', purposeKey: 'store-first-purchase-30d-repurchase', stores: ['星桥直营店', '柳岸直营店'], dataPath: '020_clean/willowbank_orders.csv',
    });
    assert.equal(evalStarOther.json.evaluation.allowed, false);
    assert.equal(evalStarOther.json.evaluation.neverTreatAsZero, true);

    const starMats = await srv.req(`/api/studio/materials?projectId=${projStar.id}`);
    assert.equal(starMats.status, 200);
    const starLocators = starMats.json.materials.map((m: any) => m.ref.locator);
    assert.equal(starLocators.includes('020_clean/starbridge_orders.csv'), true);
    assert.equal(starLocators.includes('020_clean/willowbank_orders.csv'), false);

    // Revoking projStar's grant IMMEDIATELY blocks 020_clean/starbridge_orders.csv in /api/studio/materials!
    assert.equal((await srv.req(`/api/studio/resource-grants/${starGrantId}/revoke`, 'POST', { requestId: randomUUID(), reason: '测试即时撤回' })).status, 200);
    const starMatsAfterRevoke = await srv.req(`/api/studio/materials?projectId=${projStar.id}`);
    assert.equal(starMatsAfterRevoke.json.materials.filter((m: any) => m.ref.authority === 'data').length, 0);

    // Merchandising (definition-only) sees NO detail 020_clean files
    const merchMats = await srv.req(`/api/studio/materials?projectId=${projMerch.id}`);
    assert.equal(merchMats.status, 200);
    assert.equal(merchMats.json.materials.filter((m: any) => m.ref.authority === 'data').length, 0);

    // 6. R6: Archiving construction project rejects BOTH explicit projectId AND omitted projectId (409), while active projAud continues SAME packId!
    assert.equal((await srv.req(`/api/projects/${projBuild.id}/archive`, 'POST', {})).status, 200);
    const archivedExplicit = await srv.req(`/api/studio/enterprise-packs/${packId}/purposes`, 'POST', {
      requestId: randomUUID(), projectId: projBuild.id, ...purposeBase, dependencies: [{ id: 'dep-m', role: 'member-rule', authority: 'enterprise', ref: memberRuleRef, requiredFor: ['definition-reference'] }],
    });
    assert.equal(archivedExplicit.status, 409);
    assert.equal(archivedExplicit.json.code, 'studio_project_read_only');

    const archivedOmitted = await srv.req(`/api/studio/enterprise-packs/${packId}/purposes`, 'POST', {
      requestId: randomUUID(), ...purposeBase, dependencies: [{ id: 'dep-m', role: 'member-rule', authority: 'enterprise', ref: memberRuleRef, requiredFor: ['definition-reference'] }],
    });
    assert.equal(archivedOmitted.status, 409);
    assert.equal(archivedOmitted.json.code, 'studio_project_read_only');

    const contWrite = await srv.req(`/api/studio/enterprise-packs/${packId}/purposes`, 'POST', {
      requestId: randomUUID(),
      projectId: projAud.id,
      purposeKey: 'monthly-purchase-active',
      title: '自然月购买活跃率',
      businessQuestion: '自然月去重购买活跃率',
      subjectUnit: 'brand_account',
      windowDays: 30,
      scope: { brand: '岚线', channel: '直营', period: '2026-09', scopeKey: 'lanxian:direct:active:2026-09' },
      tier: 'definition-reference',
      businessStatus: 'active',
      originalGoal: '区分购买活跃与活动签到',
      remainingGaps: [],
      exclusions: ['活动签到不计入购买活跃'],
      completionCriteria: '自然月去重有效购买',
      evidenceReadiness: { definition: 'pass' as const },
      dependencies: [{ id: 'dep-m-act', role: 'member-rule', authority: 'enterprise', ref: memberRuleRef, requiredFor: ['definition-reference'] }],
    });
    assert.equal(contWrite.status, 200);
    assert.equal(contWrite.json.pack.id, packId);

    // 7. R6: Close host & reopen with --disable-member-pack (memberPackEnabled: false) -> ALL 3 stores read-only, bytes untouched!
    await srv.close();
    const storeFiles = [
      path.join(root, 'data', 'member-packs', 'domain-references.json'),
      path.join(root, 'data', 'member-packs', 'resource-grants.json'),
      path.join(root, 'data', 'member-packs', 'enterprise-packs.json'),
    ];
    const beforeDigests = storeFiles.map(f => sha(fs.readFileSync(f)));

    const roSrv = await startTestHost(root, { memberPackEnabled: false });
    try {
      const roPack = await roSrv.req(`/api/studio/enterprise-packs/${packId}`);
      assert.equal(roPack.status, 200);
      assert.equal(roPack.json.pack.id, packId);
      assert.equal(roPack.json.readOnlyRollback, true);
      const roRefs = await roSrv.req('/api/studio/domain-references');
      assert.equal(roRefs.status, 200);
      assert.equal(roRefs.json.readOnlyRollback, true);
      const roGrants = await roSrv.req(`/api/studio/resource-grants?enterpriseId=${enterpriseId}`);
      assert.equal(roGrants.status, 200);
      assert.equal(roGrants.json.readOnlyRollback, true);

      // ALL 3 stores block writes with 503 member_pack_disabled_readonly!
      const wRef = await roSrv.req('/api/studio/domain-references/repo-template', 'POST', { requestId: randomUUID(), templateId: 'T03' });
      assert.equal(wRef.status, 503);
      assert.equal(wRef.json.code, 'member_pack_disabled_readonly');

      const wGrant = await roSrv.req('/api/studio/resource-grants', 'POST', {
        requestId: randomUUID(), enterpriseId, grantor: '原权责方', grantBasis: '回退期禁止写入',
        subjectType: 'project', subjectId: projMerch.id, resourceKind: 'definition',
        purposeKeys: ['store-first-purchase-30d-repurchase'], operations: ['read-definition'], scope: {},
      });
      assert.equal(wGrant.status, 503);
      assert.equal(wGrant.json.code, 'member_pack_disabled_readonly');

      const wRevoke = await roSrv.req(`/api/studio/resource-grants/${goodSummaryGrant.json.grant.id}/revoke`, 'POST', { requestId: randomUUID(), reason: '回退期禁止撤回' });
      assert.equal(wRevoke.status, 503);
      assert.equal(wRevoke.json.code, 'member_pack_disabled_readonly');

      const wPack = await roSrv.req(`/api/studio/enterprise-packs/${packId}/purposes`, 'POST', {
        requestId: randomUUID(), projectId: projAud.id, ...purposeBase, dependencies: [{ id: 'dep-m', role: 'member-rule', authority: 'enterprise', ref: memberRuleRef, requiredFor: ['definition-reference'] }],
      });
      assert.equal(wPack.status, 503);
      assert.equal(wPack.json.code, 'member_pack_disabled_readonly');

      const afterDigests = storeFiles.map(f => sha(fs.readFileSync(f)));
      assert.deepEqual(afterDigests, beforeDigests, 'All 3 JSON stores MUST remain byte-for-byte intact during --disable-member-pack rollback');
    } finally {
      await roSrv.close();
    }
  } finally {
    try { await srv.close(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});
