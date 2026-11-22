import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createHost } from '../src/host/server.ts';
import type { MemberPackHostOptions } from '../src/host/member-pack-host.ts';
import { CaseStore } from '../src/host/case-store.ts';
import { ProjectStore } from '../src/host/project-store.ts';
import { withCaseGoal } from './fixtures/case-goal.ts';

import { buildAuthorizedDataView } from '../src/host/member-pack-data-view.ts';

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

async function startTestHost(
  root: string,
  opts: {
    memberPackEnabled?: boolean;
    memberPackPublishHook?: MemberPackHostOptions['publishAuthorityDependency'];
    resolveOperator?: Parameters<typeof createHost>[0]['resolveOperator'];
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
    resolveOperator: opts.resolveOperator,
  });
  await new Promise<void>(resolve => host.server.listen(0, '127.0.0.1', resolve));
  const addr = host.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  let sessionCookie = '';
  const req = async <T = any>(pathname: string, method: 'GET' | 'POST' | 'PUT' = 'GET', body?: unknown, extraHeaders?: Record<string, string>) => {
    const hasExplicitCookie = extraHeaders !== undefined && Object.keys(extraHeaders).some(k => k.toLowerCase() === 'cookie');
    const hdrs: Record<string, string> = {
      'x-optracall-client': '1',
      'content-type': 'application/json',
      origin: `http://127.0.0.1:${uiPort}`,
      ...(!hasExplicitCookie && sessionCookie ? { cookie: sessionCookie } : {}),
      ...(extraHeaders ?? {}),
    };
    if (hasExplicitCookie && hdrs.cookie === '') delete hdrs.cookie;
    const res = await fetch(`${base}${pathname}`, {
      method,
      headers: hdrs,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = text; }
    const setCookie = res.headers.get('set-cookie') ?? '';
    if (!hasExplicitCookie && setCookie.includes('optracall_op_ctx=')) {
      sessionCookie = setCookie.split(';')[0] ?? '';
    }
    return { status: res.status, json: json as T, setCookie, headers: res.headers };
  };
  return { host, base, req, getCookie: () => sessionCookie, clearCookie: () => { sessionCookie = ''; }, close: async () => { await host.close(); } };
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

    // 4. R1.1 (Zero Side Effects on Stale Preview) + R1.3 (Operation-Aware Reconcile) + R1.4 (Selective Carry-Over)
    const sapValidate = await srv.req('/api/metric-factory/draft/validate', 'POST', {
      projectId: projBuild.id,
      path: '020_clean/member-repurchase.sap.yaml',
    });
    assert.equal(sapValidate.status, 200);
    const realSapDraftRef = {
      authority: 'sap-metric' as const,
      id: 'membership-repurchase',
      version: '1.0.0',
      sha256: sapValidate.json.bytesSha256,
      projectId: projBuild.id,
      locator: '020_clean/member-repurchase.sap.yaml',
      title: '会员复购率 1.0.0（草案）',
    };
    await srv.req(`/api/studio/enterprise-packs/${packId}/purposes`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      ...purposeBase,
      dependencies: [
        { id: 'dep-r', role: 'shared-asset', authority: 'sap-method', ref: refundMethodRef, requiredFor: ['formal-calculation'] },
        { id: 'dep-m', role: 'member-rule', authority: 'enterprise', ref: memberRuleRef, requiredFor: ['definition-reference', 'formal-calculation'] },
        { id: 'dep-s', role: 'sap-metric', authority: 'sap-metric', ref: realSapDraftRef, requiredFor: ['formal-calculation'] },
      ],
    });

    // R1.1 COUNTEREXAMPLE: Prepare preview v1.1 referencing unpublished SAP draft -> mutate purpose -> confirm MUST return 409
    // AND MUST NOT write membership-repurchase@1.0.0 into real SAP MetricLibrary (ZERO side effects)!
    const stalePrev = await srv.req(`/api/studio/enterprise-packs/${packId}/previews`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      version: '1.1',
      previousVersion: '1.0',
      purposeIds: [defPurposeId, calcPurposeId],
      decisions: [{ purposeId: calcPurposeId, choiceId: 'cross-store-scope', selectedKey: 'any-direct', decidedBy: '会员运营负责人' }],
      policyEffectiveFrom: '2026-09-01',
      dataCutoffAt: '2026-10-31',
      summary: '草案漂移零副作用测试预览',
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
        { id: 'dep-s', role: 'sap-metric', authority: 'sap-metric', ref: realSapDraftRef, requiredFor: ['formal-calculation'] },
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
    const sapLibAfterDrift = await srv.req('/api/metric-factory/library');
    assert.equal(sapLibAfterDrift.status, 200);
    assert.equal(
      (sapLibAfterDrift.json.entries ?? []).some((e: any) => e.id === 'membership-repurchase' && e.version === '1.0.0'),
      false,
      'Stale preview 409 MUST leave real SAP MetricLibrary completely untouched (ZERO side effects)!',
    );

    // R1.3 COUNTEREXAMPLE (External unrelated publish MUST NOT be credited to an old 'unknown' pack request!):
    // Fresh preview v1.1 + confirm where SAP returns 'unknown' (not written by pack)
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

    // External publish with DIFFERENT publishedBy ('synthetic-reviewer' != pack's authorityPublishedBy)
    const sapPubExternal = await srv.req('/api/metric-factory/publish', 'POST', {
      projectId: projBuild.id,
      path: '020_clean/member-repurchase.sap.yaml',
      publishedBy: 'synthetic-reviewer',
      expectedPackageFingerprint: sapValidate.json.packageFingerprint,
    });
    assert.equal(sapPubExternal.status, 201);

    // Reconcile MUST NOT falsely attribute external publish to the old unknown pack request!
    const recExternal = await srv.req(`/api/studio/enterprise-packs/${packId}/reconcile`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      version: '1.1',
      targetRequestId: unknownSapReceipt.requestId,
    });
    assert.equal(recExternal.status, 200);
    assert.equal(recExternal.json.revision.moduleReceipts.at(-1).status, 'unknown', 'External publish by another publisher MUST NOT falsely mark old unknown request succeeded!');
    assert.equal(recExternal.json.revision.purposeManifests.find((p: any) => p.purposeId === calcPurposeId).status, 'suspended');

    // R1.4 (Selective republication of ONLY calcPurposeId carries over unchanged defPurposeId!)
    // + R1.3 genuine recovery when SAP 1.0.1 was genuinely published by THIS pack operation before simulated timeout!
    const v101Yaml = rawSapYaml
      .replace('version: 1.0.0', 'version: 1.0.1')
      .replace('指定时间窗口内', '跨月全额退款原单冲销后指定时间窗口内');
    fs.writeFileSync(path.join(projBuild.rootPath, '020_clean', 'member-repurchase-101.sap.yaml'), v101Yaml);
    const sapVal101 = await srv.req('/api/metric-factory/draft/validate', 'POST', {
      projectId: projBuild.id,
      path: '020_clean/member-repurchase-101.sap.yaml',
    });
    assert.equal(sapVal101.status, 200);
    const sapRef101 = {
      authority: 'sap-metric' as const,
      id: 'membership-repurchase',
      version: '1.0.1',
      sha256: sapVal101.json.bytesSha256,
      projectId: projBuild.id,
      locator: '020_clean/member-repurchase-101.sap.yaml',
      title: '会员复购率 1.0.1',
    };
    await srv.req(`/api/studio/enterprise-packs/${packId}/purposes`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      ...purposeBase,
      completionCriteria: '草案变更后的完成标准',
      dependencies: [
        { id: 'dep-r', role: 'shared-asset', authority: 'sap-method', ref: refundMethodRef, requiredFor: ['formal-calculation'] },
        { id: 'dep-m', role: 'member-rule', authority: 'enterprise', ref: memberRuleRef, requiredFor: ['definition-reference', 'formal-calculation'] },
        { id: 'dep-s', role: 'sap-metric', authority: 'sap-metric', ref: sapRef101, requiredFor: ['formal-calculation'] },
      ],
    });
    // Republish ONLY [calcPurposeId] (omitting defPurposeId!)
    const prevSelective = await srv.req(`/api/studio/enterprise-packs/${packId}/previews`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      version: '1.2',
      previousVersion: '1.1',
      purposeIds: [calcPurposeId],
      decisions: [{ purposeId: calcPurposeId, choiceId: 'cross-store-scope', selectedKey: 'any-direct', decidedBy: '会员运营负责人' }],
      policyEffectiveFrom: '2026-09-01',
      dataCutoffAt: '2026-10-31',
      summary: '仅重发受影响计算用途 v1.2',
    });
    assert.equal(prevSelective.status, 200);
    // Simulate transport timeout AFTER this exact pack operation's SAP write actually landed with matching authorityPublishedBy
    const expectedPackPublisher = `企业会员包:PACK-MEM-001:${prevSelective.json.preview.id}`;
    simulateUnknownSapOnce = true;
    const confSelective = await srv.req(`/api/studio/enterprise-packs/${packId}/confirm`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      previewId: prevSelective.json.preview.id,
      fingerprint: prevSelective.json.preview.fingerprint,
      confirmedBy: '会员运营负责人',
    });
    assert.equal(confSelective.status, 200);
    const carriedDefManifest = confSelective.json.revision.purposeManifests.find((p: any) => p.purposeId === defPurposeId);
    assert.ok(carriedDefManifest, 'Unchanged defPurposeId MUST be carried over when only calcPurposeId is republished!');
    assert.equal(carriedDefManifest.status, 'eligible');
    assert.equal(carriedDefManifest.carriedOverFromVersion, '1.1');

    // Simulate that the original pack operation's write actually committed in SAP MetricLibrary with matching publisher tag
    const sapPubMatching = await srv.req('/api/metric-factory/publish', 'POST', {
      projectId: projBuild.id,
      path: '020_clean/member-repurchase-101.sap.yaml',
      publishedBy: expectedPackPublisher,
      expectedPackageFingerprint: sapVal101.json.packageFingerprint,
    });
    assert.equal(sapPubMatching.status, 201);
    const unknown101Receipt = confSelective.json.revision.moduleReceipts.find((r: any) => r.targetRef.version === '1.0.1');
    assert.equal(unknown101Receipt.status, 'unknown');
    const recMatched = await srv.req(`/api/studio/enterprise-packs/${packId}/reconcile`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      version: '1.2',
      targetRequestId: unknown101Receipt.requestId,
    });
    assert.equal(recMatched.status, 200);
    assert.equal(recMatched.json.revision.purposeManifests.find((p: any) => p.purposeId === calcPurposeId).status, 'eligible');
    assert.equal(recMatched.json.revision.purposeManifests.find((p: any) => p.purposeId === defPurposeId).status, 'eligible');
    assert.ok(recMatched.json.revision.moduleReceipts.some((r: any) => r.receiptId === unknown101Receipt.receiptId && r.status === 'unknown'));
    assert.equal(recMatched.json.revision.moduleReceipts.at(-1).status, 'succeeded');

    // 5. R2: Default-deny + Consistent Pack History Redaction + Authentic Grantor/Revoker + Summary Scope Verification!
    const ungrantedPackView = await srv.req(`/api/studio/enterprise-packs/${packId}?projectId=${projUngranted.id}`);
    assert.equal(ungrantedPackView.status, 200);
    assert.deepEqual(ungrantedPackView.json.pack.purposes, []);
    assert.deepEqual(ungrantedPackView.json.pack.entries, []);
    assert.deepEqual(ungrantedPackView.json.pack.packRevisions, [], 'Ungranted consumer project MUST NOT receive raw packRevisions!');

    // R2.1 COUNTEREXAMPLE: Omitted grantorProjectId, ordinary consumer project, OR forged owner projectId WITHOUT Host-issued authorityToken MUST be rejected with 403!
    await srv.req(`/api/projects/${projBuild.id}`);
    const omittedGrantor = await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      grantor: '自称原权责方',
      grantBasis: '省略授予方项目反例',
      subjectType: 'project',
      subjectId: projMerch.id,
      resourceKind: 'definition',
      purposeKeys: ['store-first-purchase-30d-repurchase'],
      operations: ['read-definition'],
      scope: { brand: '岚线', channel: '直营' },
    });
    assert.equal(omittedGrantor.status, 403);
    assert.equal(omittedGrantor.json.code, 'resource_grantor_not_authorized');

    await srv.req(`/api/projects/${projStar.id}`);
    const consumerGrantor = await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      grantorProjectId: projStar.id,
      grantBasis: '普通分析项目越权授予反例',
      subjectType: 'project',
      subjectId: projMerch.id,
      resourceKind: 'definition',
      purposeKeys: ['store-first-purchase-30d-repurchase'],
      operations: ['read-definition'],
      scope: { brand: '岚线', channel: '直营' },
    });
    assert.equal(consumerGrantor.status, 403);
    assert.equal(consumerGrantor.json.code, 'resource_grantor_not_authorized');

    // Consumer project MUST NOT receive grantAuthority from pack view or authority endpoint!
    assert.equal(ungrantedPackView.json.grantAuthority, undefined, 'Consumer pack view MUST NOT expose authorityToken!');
    assert.equal((await srv.req(`/api/studio/resource-grants/authority?enterpriseId=${enterpriseId}&projectId=${projStar.id}`)).status, 403);

    // Switch back to authentic owner project projBuild; forging projBuild.id WITHOUT Host-issued authorityToken MUST still be rejected with 403!
    await srv.req(`/api/projects/${projBuild.id}`);
    const forgedOwnerNoToken = await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      grantorProjectId: projBuild.id,
      grantBasis: '仅传请求体 ownerProjectId 无凭据反例',
      subjectType: 'project',
      subjectId: projMerch.id,
      resourceKind: 'definition',
      purposeKeys: ['store-first-purchase-30d-repurchase'],
      operations: ['read-definition'],
      scope: { brand: '岚线', channel: '直营' },
    });
    assert.equal(forgedOwnerNoToken.status, 403);
    assert.equal(forgedOwnerNoToken.json.code, 'resource_grantor_not_authorized');

    // Fetch authentic Host-minted grantAuthority ONLY available to the real active owner project projBuild!
    const buildAuthRes = await srv.req(`/api/studio/resource-grants/authority?enterpriseId=${enterpriseId}&projectId=${projBuild.id}`);
    assert.equal(buildAuthRes.status, 200);
    const buildAuth = buildAuthRes.json.grantAuthority;
    assert.equal(buildAuth.ownerProjectId, projBuild.id);
    assert.match(buildAuth.authorityToken, /^[a-f0-9]{64}$/);

    // Forged/nonexistent summary asset MUST be rejected!
    const badSummaryGrant = await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      grantorProjectId: projBuild.id,
      authorityToken: buildAuth.authorityToken,
      grantBasis: '尝试授权不存在汇总',
      subjectType: 'project',
      subjectId: projHQ.id,
      resourceKind: 'summary',
      purposeKeys: ['store-first-purchase-30d-repurchase'],
      operations: ['read-definition', 'cite-summary'],
      scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店'], periodFrom: '2026-09-01', periodTo: '2026-09-30', grain: 'store-month', summaryAssetId: randomUUID(), summaryVersion: '1' },
    });
    assert.equal(badSummaryGrant.status, 404);

    // R2.2 COUNTEREXAMPLE: Summary grant with mismatched period or mismatched grain MUST be rejected with 409 summary_scope_mismatch!
    const badSummaryPeriod = await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      grantorProjectId: projBuild.id,
      authorityToken: buildAuth.authorityToken,
      grantBasis: '期间越界汇总授权反例',
      subjectType: 'project',
      subjectId: projHQ.id,
      resourceKind: 'summary',
      resourceRef: realSummaryRef,
      purposeKeys: ['store-first-purchase-30d-repurchase'],
      operations: ['read-definition', 'cite-summary'],
      scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店'], periodFrom: '2026-10-01', periodTo: '2026-10-31', grain: 'store-month', summaryAssetId: realSummaryRef.id, summaryVersion: realSummaryRef.version },
    });
    assert.equal(badSummaryPeriod.status, 409);
    assert.equal(badSummaryPeriod.json.code, 'summary_scope_mismatch');

    const badSummaryGrain = await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      grantorProjectId: projBuild.id,
      authorityToken: buildAuth.authorityToken,
      grantBasis: '粒度不符汇总授权反例',
      subjectType: 'project',
      subjectId: projHQ.id,
      resourceKind: 'summary',
      resourceRef: realSummaryRef,
      purposeKeys: ['store-first-purchase-30d-repurchase'],
      operations: ['read-definition', 'cite-summary'],
      scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店'], periodFrom: '2026-09-01', periodTo: '2026-09-30', grain: 'member-day', summaryAssetId: realSummaryRef.id, summaryVersion: realSummaryRef.version },
    });
    assert.equal(badSummaryGrain.status, 409);
    assert.equal(badSummaryGrain.json.code, 'summary_scope_mismatch');

    // Real verified summary grant by authentic authority owner projBuild: Host overrides spoofed grantor & records verified owner project + credential!
    const goodSummaryGrant = await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      grantorProjectId: projBuild.id,
      grantorSystemId: buildAuth.systemId,
      grantorTaskId: buildAuth.ownerTaskId,
      authorityToken: buildAuth.authorityToken,
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
    assert.equal(goodSummaryGrant.json.grant.grantorProjectId, projBuild.id);
    assert.equal(goodSummaryGrant.json.grant.grantorCredentialVerified, true);
    assert.notEqual(goodSummaryGrant.json.grant.grantor, '伪造授权人');
    assert.equal(goodSummaryGrant.json.grant.scope.summarySha256, realSummaryRef.sha256);

    assert.equal((await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      grantorProjectId: projBuild.id,
      authorityToken: buildAuth.authorityToken,
      grantBasis: '商品部定义查阅',
      subjectType: 'project',
      subjectId: projMerch.id,
      resourceKind: 'definition',
      purposeKeys: ['store-first-purchase-30d-repurchase', 'store-first-purchase-30d-repurchase-def'],
      operations: ['read-definition'],
      scope: { brand: '岚线', channel: '直营' },
    })).status, 200);
    const starGrantRes = await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      grantorProjectId: projBuild.id,
      authorityToken: buildAuth.authorityToken,
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

    assert.equal((await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      grantorProjectId: projBuild.id,
      authorityToken: buildAuth.authorityToken,
      grantBasis: '两店核算岗跨店复算',
      subjectType: 'project',
      subjectId: projAud.id,
      resourceKind: 'detail',
      purposeKeys: ['store-first-purchase-30d-repurchase'],
      operations: ['read-definition', 'read-detail-recalculate'],
      scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店', '柳岸直营店'], allowedDataPaths: ['020_clean/starbridge_orders.csv', '020_clean/willowbank_orders.csv'] },
    })).status, 200);

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

    // R2.1 Revoker counterexample: omitted, consumer project, OR forged owner WITHOUT authorityToken MUST be rejected with 403!
    assert.equal((await srv.req(`/api/studio/resource-grants/${starGrantId}/revoke`, 'POST', { requestId: randomUUID(), reason: '省略撤回方反例' })).status, 403);
    assert.equal((await srv.req(`/api/studio/resource-grants/${starGrantId}/revoke`, 'POST', { requestId: randomUUID(), revokerProjectId: projStar.id, reason: '普通项目越权撤回反例' })).status, 403);
    assert.equal((await srv.req(`/api/studio/resource-grants/${starGrantId}/revoke`, 'POST', { requestId: randomUUID(), revokerProjectId: projBuild.id, reason: '无凭据伪造原权责项目撤回反例' })).status, 403);

    // Revoking projStar's grant by authentic authority owner projBuild WITH verified authorityToken IMMEDIATELY blocks 020_clean/starbridge_orders.csv!
    const revokeOk = await srv.req(`/api/studio/resource-grants/${starGrantId}/revoke`, 'POST', {
      requestId: randomUUID(),
      revokerProjectId: projBuild.id,
      authorityToken: buildAuth.authorityToken,
      reason: '测试即时撤回',
    });
    assert.equal(revokeOk.status, 200);
    assert.equal(revokeOk.json.grant.revokedByProjectId, projBuild.id);
    const starMatsAfterRevoke = await srv.req(`/api/studio/materials?projectId=${projStar.id}`);
    assert.equal(starMatsAfterRevoke.json.materials.filter((m: any) => m.ref.authority === 'data').length, 0);

    // Merchandising (definition-only) sees NO detail 020_clean files
    const merchMats = await srv.req(`/api/studio/materials?projectId=${projMerch.id}`);
    assert.equal(merchMats.status, 200);
    assert.equal(merchMats.json.materials.filter((m: any) => m.ref.authority === 'data').length, 0);

    // 5B. R5.2: Routing feedback creates REAL linked Studio workItem & feedback in StudioStore!
    const fbDirect = await srv.req(`/api/studio/enterprise-packs/${packId}/feedback`, 'POST', {
      requestId: randomUUID(),
      problemKey: 'refund-link-studio',
      packVersion: '1.2',
      purposeIds: [calcPurposeId],
      title: '核实跨月退款与原 Studio 联动',
      category: 'shared_refund_mapping',
      targetAssetRef: refundMethodRef,
      report: {
        projectId: projAud.id,
        taskId: randomUUID(),
        sessionId: 'sess-host',
        messageId: 'msg-host',
        reportRef: { authority: 'task', id: randomUUID(), projectId: projAud.id, version: '1', sha256: sha('host-rep'), locator: '060_reports/host.md' },
        adoptionBasis: 'verified_actual_read',
        usedPackVersion: '1.2',
        usedAssetRefs: [refundMethodRef],
        evidenceNote: '需在原 Studio 建立关联工作项',
      },
    });
    assert.equal(fbDirect.status, 200);
    const handledStudio = await srv.req(`/api/studio/enterprise-packs/${packId}/feedback/${fbDirect.json.feedback.id}/handle`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      status: 'investigating',
      note: '转入原 Studio 工作项跟进',
      impactedPurposeIds: [calcPurposeId],
    });
    assert.equal(handledStudio.status, 200);
    const linkedWorkItemId = handledStudio.json.feedback.authorityHandling.studioWorkItemId;
    const linkedFeedbackId = handledStudio.json.feedback.authorityHandling.studioFeedbackId;
    assert.ok(linkedWorkItemId, 'Routing feedback MUST create real Studio workItem and record studioWorkItemId!');
    assert.ok(linkedFeedbackId, 'Routing feedback MUST create real Studio feedback and record studioFeedbackId!');
    const sysAfterRoute = await srv.req(`/api/studio/systems/${systemId}`);
    assert.equal(sysAfterRoute.status, 200);
    assert.ok(sysAfterRoute.json.system.workItems.some((w: any) => w.id === linkedWorkItemId));
    assert.ok(sysAfterRoute.json.system.feedback.some((f: any) => f.id === linkedFeedbackId));

    // 6. R6: Archiving construction project rejects BOTH explicit projectId AND omitted projectId (409), while active projAud continues SAME packId & binds continuation owner!
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
    assert.equal(contWrite.json.pack.activeOwnerProjectId, projAud.id, 'Continuation from another active project MUST bind activeOwnerProjectId!');
    assert.equal(contWrite.json.pack.continuationHistory.length, 1);

    // 7. R6: Close host & reopen with --disable-member-pack (memberPackEnabled: false) -> ALL 3 stores read-only, bytes untouched, AND new task receives ZERO pack supply!
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

      // R6.1: Granted consumer project with no historical pins MUST receive ZERO pack purposes/revisions during --disable-member-pack rollback!
      const roMerchPack = await roSrv.req(`/api/studio/enterprise-packs/${packId}?projectId=${projMerch.id}`);
      assert.equal(roMerchPack.status, 200);
      assert.equal(roMerchPack.json.readOnlyRollback, true);
      assert.deepEqual(roMerchPack.json.pack.purposes, [], 'Consumer project MUST NOT receive new pack purposes during --disable-member-pack rollback!');
      assert.deepEqual(roMerchPack.json.pack.packRevisions, [], 'Consumer project without historical pins MUST NOT receive active packRevisions during rollback!');

      // ALL 3 stores block writes with 503 member_pack_disabled_readonly!
      const wRef = await roSrv.req('/api/studio/domain-references/repo-template', 'POST', { requestId: randomUUID(), templateId: 'T03' });
      assert.equal(wRef.status, 503);
      assert.equal(wRef.json.code, 'member_pack_disabled_readonly');

      const wGrant = await roSrv.req('/api/studio/resource-grants', 'POST', {
        requestId: randomUUID(), enterpriseId, grantorProjectId: projAud.id, grantBasis: '回退期禁止写入',
        subjectType: 'project', subjectId: projMerch.id, resourceKind: 'definition',
        purposeKeys: ['store-first-purchase-30d-repurchase'], operations: ['read-definition'], scope: {},
      });
      assert.equal(wGrant.status, 503);
      assert.equal(wGrant.json.code, 'member_pack_disabled_readonly');

      const wRevoke = await roSrv.req(`/api/studio/resource-grants/${goodSummaryGrant.json.grant.id}/revoke`, 'POST', { requestId: randomUUID(), revokerProjectId: projAud.id, reason: '回退期禁止撤回' });
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

test('Host Round-4 counterexamples: two v1.0 previews cannot both publish, unrelated Studio system in same enterprise cannot grant/revoke another pack, detail grant omitting allowedDataPaths stays deny-detail, and redacted pack strips moduleReceipts/decisionsSnapshot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optracall-member-pack-host-r4-'));
  const srv = await startTestHost(root);
  try {
    const ent = await srv.req('/api/studio/enterprises', 'POST', { requestId: randomUUID(), name: 'Round-4 隔离测试企业' });
    assert.equal(ent.status, 201);
    const enterpriseId = ent.json.id;

    const cfg = await srv.req('/api/configuration', 'PUT', {
      name: 'Member Pack R4 Synthetic',
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1/v1',
      model: 'synthetic-member-pack',
      apiKey: 'synthetic-only',
    });
    assert.equal(cfg.status, 200);

    const createProj = async (name: string) => {
      const p = await srv.req('/api/projects', 'POST', { name });
      assert.equal(p.status, 201);
      assert.equal((await srv.req('/api/studio/enterprise-associations', 'POST', {
        requestId: randomUUID(), kind: 'project', entityId: p.json.project.id, enterpriseId,
      })).status, 200);
      return p.json.project;
    };

    const projOwner1 = await createProj('会员体系主项目');
    const projOwner2 = await createProj('同企业无关第二体系项目');
    const projConsumer = await createProj('分析消费项目');
    fs.writeFileSync(path.join(projConsumer.rootPath, '020_clean', 'secret_store.csv'), 'account,amt\nS1,100\n');

    const sys1 = await srv.req('/api/studio/systems', 'POST', {
      requestId: randomUUID(), enterpriseId, name: '会员体系一', projectId: projOwner1.id, goal: '建设会员包', topicTitle: '会员',
    });
    assert.equal(sys1.status, 201);
    const sys2 = await srv.req('/api/studio/systems', 'POST', {
      requestId: randomUUID(), enterpriseId, name: '财务无关体系二', projectId: projOwner2.id, goal: '无关体系', topicTitle: '财务',
    });
    assert.equal(sys2.status, 201);

    const mat = await srv.req('/api/enterprise-materials', 'POST', { title: '有效购买口径 R4', body: '有效购买口径正文' });
    assert.equal(mat.status, 201);
    const matEnabled = await srv.req(`/api/enterprise-materials/${mat.json.material.id}/enable`, 'POST', { expectedVersion: mat.json.material.version });
    assert.equal(matEnabled.status, 200);
    assert.equal((await srv.req('/api/studio/enterprise-associations', 'POST', {
      requestId: randomUUID(), kind: 'asset', authority: 'enterprise', entityId: mat.json.material.id, enterpriseId,
    })).status, 200);
    const matRef = {
      authority: 'enterprise' as const,
      id: mat.json.material.id,
      version: matEnabled.json.material.revisions[0].revisionId,
      sha256: matEnabled.json.material.revisions[0].bodySha256,
      locator: matEnabled.json.storeId,
      title: '有效购买口径 R4',
    };

    const packRes = await srv.req('/api/studio/enterprise-packs', 'POST', {
      requestId: randomUUID(), enterpriseId, systemId: sys1.json.system.id, domain: 'member-operations', name: '会员包 R4',
    });
    assert.equal(packRes.status, 200);
    const packId = packRes.json.pack.id;

    const pRes = await srv.req(`/api/studio/enterprise-packs/${packId}/purposes`, 'POST', {
      requestId: randomUUID(),
      projectId: projOwner1.id,
      purposeKey: 'r4-member-def',
      title: 'R4 会员口径定义',
      businessQuestion: '定义有效购买',
      subjectUnit: 'brand_account',
      scope: { brand: '岚线', channel: '直营', scopeKey: 'r4:def' },
      tier: 'definition-reference',
      businessStatus: 'active',
      evidenceReadiness: { definition: 'pass' },
      originalGoal: '发布口径',
      completionCriteria: '可读',
      dependencies: [{ id: 'dep-r4', role: 'member-rule', authority: 'enterprise', ref: matRef, requiredFor: ['definition-reference'] }],
    });
    assert.equal(pRes.status, 200);
    const purposeId = pRes.json.purpose.id;

    // 1. R1: Prepare TWO different v1.0 previews with different dataCutoffAt and summary -> first confirms, second MUST return 409 enterprise_pack_version_exists!
    const prevA = await srv.req(`/api/studio/enterprise-packs/${packId}/previews`, 'POST', {
      requestId: randomUUID(), projectId: projOwner1.id, version: '1.0', purposeIds: [purposeId], dataCutoffAt: '2026-10-31', summary: 'v1.0 首份预览',
    });
    assert.equal(prevA.status, 200);
    const prevB = await srv.req(`/api/studio/enterprise-packs/${packId}/previews`, 'POST', {
      requestId: randomUUID(), projectId: projOwner1.id, version: '1.0', purposeIds: [purposeId], dataCutoffAt: '2026-11-30', summary: 'v1.0 另一截止日预览',
    });
    assert.equal(prevB.status, 200);
    const confirmA = await srv.req(`/api/studio/enterprise-packs/${packId}/confirm`, 'POST', {
      requestId: randomUUID(), projectId: projOwner1.id, previewId: prevA.json.preview.id, fingerprint: prevA.json.preview.fingerprint,
    });
    assert.equal(confirmA.status, 200);
    const confirmB = await srv.req(`/api/studio/enterprise-packs/${packId}/confirm`, 'POST', {
      requestId: randomUUID(), projectId: projOwner1.id, previewId: prevB.json.preview.id, fingerprint: prevB.json.preview.fingerprint,
    });
    assert.equal(confirmB.status, 409);
    assert.equal(confirmB.json.code, 'enterprise_pack_version_exists');
    const packAfterDouble = await srv.req(`/api/studio/enterprise-packs/${packId}`);
    assert.equal(packAfterDouble.json.pack.packRevisions.length, 1, 'Fixed version 1.0 MUST have strictly ONE published revision!');

    // 2. R2: Unrelated Studio system owner in the SAME enterprise (projOwner2 / sys2) MUST NOT be able to grant on packId even with its own system token!
    const owner2PackView = await srv.req(`/api/studio/enterprise-packs/${packId}?projectId=${projOwner2.id}`);
    assert.equal(owner2PackView.status, 200);
    assert.equal(owner2PackView.json.grantAuthority, undefined, 'Unrelated system owner MUST NOT receive grantAuthority for packId!');
    const owner2AuthRes = await srv.req(`/api/studio/resource-grants/authority?enterpriseId=${enterpriseId}&projectId=${projOwner2.id}&packId=${packId}`);
    assert.equal(owner2AuthRes.status, 403);

    await srv.req(`/api/projects/${projOwner2.id}`);
    const wrongSystemGrant = await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      packId,
      grantorProjectId: projOwner2.id,
      grantBasis: '无关第二体系越权授权反例',
      subjectType: 'project',
      subjectId: projConsumer.id,
      resourceKind: 'definition',
      purposeKeys: ['r4-member-def'],
      operations: ['read-definition'],
      scope: { brand: '岚线' },
    });
    assert.equal(wrongSystemGrant.status, 403);
    assert.equal(wrongSystemGrant.json.code, 'resource_grantor_not_authorized');

    await srv.req(`/api/projects/${projOwner1.id}`);
    const owner1PackView = await srv.req(`/api/studio/enterprise-packs/${packId}?projectId=${projOwner1.id}`);
    assert.equal(owner1PackView.status, 200);
    assert.ok(owner1PackView.json.grantAuthority?.authorityToken);
    const owner1Token = owner1PackView.json.grantAuthority.authorityToken;

    // Legitimate owner projOwner1 grants detail WITHOUT allowedDataPaths -> projConsumer MUST still be denied reading 020_clean/secret_store.csv!
    const noPathsGrant = await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      packId,
      grantorProjectId: projOwner1.id,
      authorityToken: owner1Token,
      grantBasis: '仅给门店未给 allowedDataPaths 反例',
      subjectType: 'project',
      subjectId: projConsumer.id,
      resourceKind: 'detail',
      purposeKeys: ['r4-member-def'],
      operations: ['read-detail-recalculate'],
      scope: { brand: '岚线', stores: ['星桥直营店'], periodFrom: '2026-09-01', periodTo: '2026-10-31' },
    });
    assert.equal(noPathsGrant.status, 200);
    const consumerMats = await srv.req(`/api/studio/materials?projectId=${projConsumer.id}`);
    assert.equal(consumerMats.status, 200);
    assert.equal(
      consumerMats.json.materials.filter((m: any) => m.ref.authority === 'data').length,
      0,
      'Omitting allowedDataPaths on a detail grant MUST NEVER unlock project 020_clean files!',
    );

    // Unrelated Studio system owner projOwner2 MUST NOT be able to revoke projOwner1's grant!
    await srv.req(`/api/projects/${projOwner2.id}`);
    const wrongRevoke = await srv.req(`/api/studio/resource-grants/${noPathsGrant.json.grant.id}/revoke`, 'POST', {
      requestId: randomUUID(),
      revokerProjectId: projOwner2.id,
      authorityToken: owner1Token,
      reason: '无关体系越权撤回反例',
    });
    assert.equal(wrongRevoke.status, 403);
    assert.equal(wrongRevoke.json.code, 'resource_revoker_not_authorized');

    // 3. R2: Consumer projection strips decisionsSnapshot, unauthorized receipts, AND grantAuthority!
    const consumerPackView = await srv.req(`/api/studio/enterprise-packs/${packId}?projectId=${projConsumer.id}`);
    assert.equal(consumerPackView.status, 200);
    assert.equal(consumerPackView.json.grantAuthority, undefined);
    assert.deepEqual(consumerPackView.json.pack.packRevisions[0]?.decisionsSnapshot ?? [], []);
  } finally {
    try { await srv.close(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Host Round-6: trusted operator binding & HttpOnly cookie anti-spoofing (R2), row-level mixed-store/period authorized data view & unfilterable fail-closed (R2), and ordinary-project referenced-report protection + preserved SHA-256 snapshot readback (R5)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optracall-member-pack-r6-host-'));
  let activeOperator = { operatorId: 'op:owner-alice', displayName: 'Alice', verified: true };
  const srv = await startTestHost(root, {
    resolveOperator: () => activeOperator,
  });
  try {
    const ent = await srv.req('/api/studio/enterprises', 'POST', { requestId: randomUUID(), name: '织屿服饰 R6' });
    assert.equal(ent.status, 201);
    const enterpriseId = ent.json.id ?? ent.json.enterprise?.id;

    const cfg = await srv.req('/api/configuration', 'PUT', {
      name: 'Member Pack R6 Synthetic',
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1/v1',
      model: 'synthetic-model',
      apiKey: 'sk-r6-test',
    });
    assert.equal(cfg.status, 200);
    const cfgId = cfg.json.configuration?.id ?? cfg.json.id;

    const pOwnerRes = await srv.req('/api/projects', 'POST', { name: 'R6 权责建设方', configurationId: cfgId, enterpriseId });
    assert.equal(pOwnerRes.status, 201);
    const projOwner = pOwnerRes.json.project;
    assert.ok(pOwnerRes.setCookie.includes('optracall_op_ctx='), 'Host MUST set HttpOnly signed optracall_op_ctx cookie on project create!');
    const ownerCookie = pOwnerRes.setCookie.split(';')[0]!;

    const pConsumerRes = await srv.req('/api/projects', 'POST', { name: 'R6 消费分析方', configurationId: cfgId, enterpriseId });
    assert.equal(pConsumerRes.status, 201);
    const projConsumer = pConsumerRes.json.project;
    const consumerCookie = pConsumerRes.setCookie.split(';')[0]!;

    const sysRes = await srv.req('/api/studio/systems', 'POST', {
      requestId: randomUUID(), projectId: projOwner.id, enterpriseId, name: 'R6 会员体系', goal: 'R6 测试', topicTitle: 'R6 主题', materials: [],
    }, { cookie: ownerCookie });
    assert.equal(sysRes.status, 201);
    const systemId = sysRes.json.system.id;

    const packRes = await srv.req('/api/studio/enterprise-packs', 'POST', {
      requestId: randomUUID(), enterpriseId, systemId, domain: 'member-operations', name: '织屿 R6 资产包',
    }, { cookie: ownerCookie });
    assert.equal(packRes.status, 200);
    const packId = packRes.json.pack.id;

    // 1. R2: Consumer's Host-signed activeProjectId cookie trying to impersonate projOwner MUST be rejected (403)!
    const spoofedAuth = await srv.req(
      `/api/studio/resource-grants/authority?enterpriseId=${enterpriseId}&projectId=${projOwner.id}&packId=${packId}`,
      'GET',
      undefined,
      { cookie: consumerCookie },
    );
    assert.equal(spoofedAuth.status, 403, 'Consumer cookie context MUST NOT obtain owner project grantAuthority!');

    // Tampered cookie MUST also be rejected (403)!
    const tamperedAuth = await srv.req(
      `/api/studio/resource-grants/authority?enterpriseId=${enterpriseId}&projectId=${projOwner.id}&packId=${packId}`,
      'GET',
      undefined,
      { cookie: 'optracall_op_ctx=forged.signature' },
    );
    assert.equal(tamperedAuth.status, 403, 'Tampered optracall_op_ctx cookie MUST be rejected!');

    // Authentic owner operator + owner cookie obtains authorityToken bound to op:owner-alice!
    const validAuth = await srv.req(
      `/api/studio/resource-grants/authority?enterpriseId=${enterpriseId}&projectId=${projOwner.id}&packId=${packId}`,
      'GET',
      undefined,
      { cookie: ownerCookie },
    );
    assert.equal(validAuth.status, 200);
    assert.equal(validAuth.json.grantAuthority.operatorId, 'op:owner-alice');
    const aliceToken = validAuth.json.grantAuthority.authorityToken;

    // Different operator (op:bob) trying to USE Alice's authorityToken OR create grant on Alice's system -> 403!
    activeOperator = { operatorId: 'op:intruder-bob', displayName: 'Bob', verified: true };
    const bobGrant = await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      packId,
      grantorProjectId: projOwner.id,
      authorityToken: aliceToken,
      grantBasis: '非原操作者复用他人令牌反例',
      subjectType: 'project',
      subjectId: projConsumer.id,
      resourceKind: 'detail',
      purposeKeys: ['store-first-purchase-30d-repurchase'],
      operations: ['read-detail-recalculate'],
      scope: { brand: '织屿', stores: ['湖庭直营店'], periodFrom: '2026-09-01', periodTo: '2026-10-31', allowedDataPaths: ['020_clean/mixed_orders.csv'] },
    });
    assert.equal(bobGrant.status, 403, 'Different Host operator MUST NOT reuse owner authorityToken or grant on bound system!');

    // Switch back to Alice + consumer cookie spoofing on POST /resource-grants -> 403!
    activeOperator = { operatorId: 'op:owner-alice', displayName: 'Alice', verified: true };
    const consumerCookieGrant = await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      packId,
      grantorProjectId: projOwner.id,
      authorityToken: aliceToken,
      grantBasis: '消费侧会话 Cookie 冒用建设侧项目授权反例',
      subjectType: 'project',
      subjectId: projConsumer.id,
      resourceKind: 'detail',
      purposeKeys: ['store-first-purchase-30d-repurchase'],
      operations: ['read-detail-recalculate'],
      scope: { brand: '织屿', stores: ['湖庭直营店'], periodFrom: '2026-09-01', periodTo: '2026-10-31', allowedDataPaths: ['020_clean/mixed_orders.csv'] },
    }, { cookie: consumerCookie });
    assert.equal(consumerCookieGrant.status, 403, 'Consumer activeProjectId cookie MUST NOT submit grant claiming grantorProjectId=projOwner!');

    // Legitimate Alice + owner cookie succeeds and records grantorOperatorId = op:owner-alice!
    const okGrant = await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      packId,
      grantorProjectId: projOwner.id,
      authorityToken: aliceToken,
      grantBasis: '原操作者 Alice 授权湖庭直营店 9-10 月明细',
      subjectType: 'project',
      subjectId: projConsumer.id,
      resourceKind: 'detail',
      purposeKeys: ['store-first-purchase-30d-repurchase'],
      operations: ['read-detail-recalculate'],
      scope: { brand: '织屿', stores: ['湖庭直营店'], periodFrom: '2026-09-01', periodTo: '2026-10-31', allowedDataPaths: ['020_clean/mixed_orders.csv'] },
    }, { cookie: ownerCookie });
    assert.equal(okGrant.status, 200);
    assert.equal(okGrant.json.grant.grantorOperatorId, 'op:owner-alice');
    assert.equal(okGrant.json.grant.grantorOperatorVerified, true);

    // Different operator Bob trying to REVOKE Alice's grant -> 403!
    activeOperator = { operatorId: 'op:intruder-bob', displayName: 'Bob', verified: true };
    const bobRevoke = await srv.req(`/api/studio/resource-grants/${okGrant.json.grant.id}/revoke`, 'POST', {
      requestId: randomUUID(),
      revokerProjectId: projOwner.id,
      authorityToken: aliceToken,
      reason: '非原操作者越权撤回反例',
    });
    assert.equal(bobRevoke.status, 403);
    activeOperator = { operatorId: 'op:owner-alice', displayName: 'Alice', verified: true };

    // 2. R2: Row-level store & period authorized data view filtering (mixed CSV + opaque fail-closed)
    const mixedCsv = [
      'order_id,store,order_date,member_id,amount',
      'O-01,湖庭直营店,2026-09-15,M01,320',
      'O-02,杉岸直营店,2026-09-16,M02,410',
      'O-03,湖庭直营店,2026-11-05,M03,500',
      'O-04,湖庭直营店,2026-10-20,M01,280',
    ].join('\n') + '\n';
    const viewRes = buildAuthorizedDataView(Buffer.from(mixedCsv, 'utf8'), '020_clean/mixed_orders.csv', [okGrant.json.grant]);
    assert.equal(viewRes.allowed, true);
    if (viewRes.allowed) {
      const out = viewRes.bytes.toString('utf8');
      assert.ok(out.includes('O-01') && out.includes('O-04'), 'Authorized 湖庭直营店 within 2026-09-01..2026-10-31 MUST be included');
      assert.ok(!out.includes('杉岸直营店') && !out.includes('O-02'), 'Unauthorized 杉岸直营店 rows MUST be stripped!');
      assert.ok(!out.includes('2026-11-05') && !out.includes('O-03'), 'Out-of-period rows (> 2026-10-31) MUST be stripped!');
    }
    const opaqueFail = buildAuthorizedDataView(Buffer.from('opaque text blob with mixed stores'), '020_clean/mixed_notes.txt', [okGrant.json.grant]);
    assert.equal(opaqueFail.allowed, false, 'Unfilterable opaque file under scoped store/period grant MUST fail closed!');

    // 3. R5: Ordinary/owner project referenced report overwrite protection via files/save-report + /report-snapshot SHA-256 readback!
    const origReportText = '# 原报告 v1.0\n湖庭直营店 30日复购率 3/4，原截止日 2026-10-31。\n';
    const savedOrig = await srv.req(`/api/projects/${projOwner.id}/files/save-report`, 'POST', {
      name: 'owner-referenced-report.md',
      text: origReportText,
    }, { cookie: ownerCookie });
    assert.equal(savedOrig.status, 201);
    const origSha = sha(origReportText);

    // Publish a minimal definition purpose & pin + record a use referencing 060_reports/owner-referenced-report.md
    const matRes = await srv.req('/api/enterprise-materials', 'POST', {
      title: 'R6 口径', body: '有效购买口径正文',
    });
    assert.equal(matRes.status, 201);
    const matEnabled = await srv.req(`/api/enterprise-materials/${matRes.json.material.id}/enable`, 'POST', {
      expectedVersion: matRes.json.material.version,
    });
    assert.equal(matEnabled.status, 200);
    await srv.req('/api/studio/enterprise-associations', 'POST', {
      requestId: randomUUID(), kind: 'asset', authority: 'enterprise', entityId: matRes.json.material.id, enterpriseId,
    });
    const matRef = { authority: 'enterprise', id: matRes.json.material.id, version: matEnabled.json.material.revisions[0].revisionId, sha256: matEnabled.json.material.revisions[0].sha256 };
    const pDef = await srv.req(`/api/studio/enterprise-packs/${packId}/purposes`, 'POST', {
      requestId: randomUUID(), projectId: projOwner.id, purposeKey: 'r6-def', title: 'R6 定义', businessQuestion: '定义', subjectUnit: 'brand_account',
      scope: { brand: '织屿', scopeKey: 'zhiyu:r6:def' }, tier: 'definition-reference', businessStatus: 'active', evidenceReadiness: { definition: 'pass' },
      originalGoal: '定义', completionCriteria: '可读', dependencies: [{ id: 'd-def', role: 'member-rule', authority: 'enterprise', ref: matRef, requiredFor: ['definition-reference'] }],
    }, { cookie: ownerCookie });
    const prevDef = await srv.req(`/api/studio/enterprise-packs/${packId}/previews`, 'POST', {
      requestId: randomUUID(), projectId: projOwner.id, version: '1.0', purposeIds: [pDef.json.purpose.id], dataCutoffAt: '2026-10-31', summary: 'v1.0',
    }, { cookie: ownerCookie });
    await srv.req(`/api/studio/enterprise-packs/${packId}/confirm`, 'POST', {
      requestId: randomUUID(), projectId: projOwner.id, previewId: prevDef.json.preview.id, fingerprint: prevDef.json.preview.fingerprint,
    }, { cookie: ownerCookie });
    const ownerTaskRes = await srv.req(`/api/projects/${projOwner.id}/tasks`, 'POST', { name: 'R6 原报告任务' });
    assert.equal(ownerTaskRes.status, 201);
    const ownerTaskId = ownerTaskRes.json.task.id;
    const pinRes = await srv.req(`/api/studio/enterprise-packs/${packId}/pin`, 'POST', {
      requestId: randomUUID(), projectId: projOwner.id, taskId: ownerTaskId, version: '1.0', authorizedScope: '织屿主品牌',
    }, { cookie: ownerCookie });
    assert.equal(pinRes.status, 200);
    const useRefRes = await srv.req(`/api/studio/enterprise-packs/${packId}/uses`, 'POST', {
      requestId: randomUUID(), projectId: projOwner.id, taskId: ownerTaskId, purposeId: pDef.json.purpose.id,
      reportRef: { authority: 'task', id: ownerTaskId, projectId: projOwner.id, taskId: ownerTaskId, version: origSha, sha256: origSha, locator: '060_reports/owner-referenced-report.md' },
    }, { cookie: ownerCookie });
    assert.equal(useRefRes.status, 200);

    // Attempt to save revised text with the SAME filename via files/save-report on ordinary/owner project -> MUST auto-save .rev-<sha8>.md and keep original untouched!
    const revisedReportText = '# 更正稿 v1.1\n湖庭直营店 30日复购率 2/4。\n';
    const savedRev = await srv.req(`/api/projects/${projOwner.id}/files/save-report`, 'POST', {
      name: 'owner-referenced-report.md',
      text: revisedReportText,
    }, { cookie: ownerCookie });
    assert.equal(savedRev.status, 201);
    assert.notEqual(savedRev.json.file.path, '060_reports/owner-referenced-report.md', 'Saving revised text for a referenced report MUST auto-save under a new conflict-safe filename!');
    assert.ok(savedRev.json.file.path.includes('.rev-'));
    // Original file on disk MUST remain 100% untouched AND /report-snapshot returns exact SHA-256 original!
    const diskOrig = fs.readFileSync(path.join(projOwner.rootPath, '060_reports', 'owner-referenced-report.md'), 'utf8');
    assert.equal(sha(diskOrig), origSha, 'Original referenced report on ordinary/owner project MUST remain untouched!');

    const snapDenied = await srv.req(
      `/api/studio/enterprise-packs/${packId}/report-snapshot?projectId=${projOwner.id}&taskId=${ownerTaskId}&locator=${encodeURIComponent('060_reports/owner-referenced-report.md')}&sha256=${origSha}`,
      'GET',
      undefined,
      { cookie: consumerCookie },
    );
    assert.equal(snapDenied.status, 403, 'Consumer project cookie MUST NOT read owner project report-snapshot!');

    const unidentified = await srv.req(
      `/api/studio/enterprise-packs/${packId}/report-snapshot?projectId=${projOwner.id}&taskId=${ownerTaskId}&locator=${encodeURIComponent('060_reports/owner-referenced-report.md')}&sha256=${origSha}`,
      'GET',
      undefined,
      { cookie: '' },
    );
    assert.equal(unidentified.status, 403, 'Serving a retained report requires current borrower or original authority context');

    const snapRes = await srv.req(
      `/api/studio/enterprise-packs/${packId}/report-snapshot?projectId=${projOwner.id}&taskId=${ownerTaskId}&locator=${encodeURIComponent('060_reports/owner-referenced-report.md')}&sha256=${origSha}`,
      'GET',
      undefined,
      { cookie: ownerCookie },
    );
    assert.equal(snapRes.status, 200);
    assert.equal(snapRes.json.sha256, origSha);
    assert.equal(snapRes.json.text, origReportText);
  } finally {
    try { await srv.close(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Host Round-7: real-product operator isolation & named business operator auth (no custom resolveOperator), fail-closed missing store col & unattributable rows, files/content authorized view filtering, natural grant expiry, and Case decision revision readback', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optracall-member-pack-r7-host-'));
  // CRITICAL: Default real-product createHost startup with NO custom resolveOperator!
  let srv = await startTestHost(root);
  try {
    // 1. Unit check on buildAuthorizedDataView: missing store column (even with non-mixed filename!) & unattributable rows FAIL CLOSED!
    const sampleGrant = [{
      id: '11111111-1111-4111-8111-111111111111',
      enterpriseId: '22222222-2222-4222-8222-222222222222',
      grantor: 'owner',
      grantorVerifiedBy: 'host' as const,
      grantBasis: 'R7',
      subjectType: 'project' as const,
      subjectId: '33333333-3333-4333-8333-333333333333',
      resourceKind: 'detail' as const,
      operations: ['read-detail-recalculate' as const],
      scope: { stores: ['湖庭直营店'], allowedDataPaths: ['020_clean/huting_orders.csv', '020_clean/unattributed.csv', '020_clean/mixed_partial_unattr.csv'] },
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    }];
    const noStoreColCsv = Buffer.from('account,order_date,amount\nC01,2026-09-10,120\n', 'utf8');
    const noStoreColRes = buildAuthorizedDataView(noStoreColCsv, '020_clean/huting_orders.csv', sampleGrant);
    assert.equal(noStoreColRes.allowed, false, 'CSV lacking store column MUST fail closed even if filename does not say mixed!');
    assert.equal(noStoreColRes.code, 'authorized_view_unavailable_missing_store_column');

    const allUnattrCsv = Buffer.from('account,order_date,store\nC01,2026-09-10,\nC02,2026-09-11,unknown\nC03,2026-09-12,未归属\n', 'utf8');
    const allUnattrRes = buildAuthorizedDataView(allUnattrCsv, '020_clean/unattributed.csv', sampleGrant);
    assert.equal(allUnattrRes.allowed, false, 'All-unattributable CSV MUST fail closed!');
    assert.equal(allUnattrRes.code, 'authorized_view_unattributable_records');

    const partialUnattrCsv = Buffer.from('account,order_date,store\nC01,2026-09-10,湖庭直营店\nC02,2026-09-11,\nC03,2026-09-12,杉岸直营店\nC04,2026-09-13,null\n', 'utf8');
    const partialRes = buildAuthorizedDataView(partialUnattrCsv, '020_clean/mixed_partial_unattr.csv', sampleGrant);
    assert.equal(partialRes.allowed, true);
    assert.equal(partialRes.keptRows, 1);
    assert.equal(partialRes.omittedRows, 3);
    assert.equal(partialRes.unattributableRows, 2);
    const partialText = partialRes.bytes.toString('utf8');
    assert.ok(partialText.includes('C01'));
    assert.ok(!partialText.includes('C02') && !partialText.includes('C03') && !partialText.includes('C04'));

    // 2. Real-product operator session isolation & named business operator auth
    await srv.req('/api/configuration', 'PUT', {
      name: 'R7 Synthetic',
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1/v1',
      model: 'synthetic-r7',
      apiKey: 'synthetic-only',
    });
    const entRes = await srv.req('/api/studio/enterprises', 'POST', { requestId: randomUUID(), name: '织屿R7' });
    const enterpriseId = entRes.json.id;

    // Context A (Owner browser session) registers named business operator `ops-owner`
    const regOwner = await srv.req('/api/studio/operators/session', 'POST', {
      action: 'register',
      operatorId: 'ops-owner',
      displayName: '会员运营负责人',
      passcode: 'owner-secret-123',
    });
    assert.equal(regOwner.status, 200);
    assert.equal(regOwner.json.operator.operatorId, 'op:ops-owner');
    assert.equal(regOwner.json.operator.verified, true);
    const ownerCookieA = regOwner.setCookie.split(';')[0]!;
    assert.ok(ownerCookieA.startsWith('optracall_op_ctx='));

    const ownerProjRes = await srv.req('/api/projects', 'POST', { name: 'R7 权责建设', enterpriseId }, { cookie: ownerCookieA });
    assert.equal(ownerProjRes.status, 201);
    const projOwner = ownerProjRes.json.project;
    const ownerTaskId: string = ownerProjRes.json.task?.id ?? projOwner.activeTaskId ?? randomUUID();
    const ownerActiveCookie = ownerProjRes.setCookie.split(';')[0]!;

    const consumerProjRes = await srv.req('/api/projects', 'POST', { name: 'R7 受限消费', enterpriseId }, { cookie: ownerActiveCookie });
    assert.equal(consumerProjRes.status, 201);
    const projConsumer = consumerProjRes.json.project;

    // Owner creates Studio system & Member Pack (binds system to op:ops-owner)
    const sysRes = await srv.req('/api/studio/systems', 'POST', {
      requestId: randomUUID(), enterpriseId, name: 'R7 体系', projectId: projOwner.id, goal: 'R7 权责与过滤测试', topicTitle: 'R7',
    }, { cookie: ownerActiveCookie });
    assert.equal(sysRes.status, 201);
    const systemId = sysRes.json.system.id;

    const packRes = await srv.req('/api/studio/enterprise-packs', 'POST', {
      requestId: randomUUID(), enterpriseId, systemId, projectId: projOwner.id, domain: 'member-operations', name: 'R7 资产包',
    }, { cookie: ownerActiveCookie });
    assert.equal(packRes.status, 200);
    const packId = packRes.json.pack.id;

    // Bare cookie-less HTTP request MUST be rejected with 403 resource_operator_not_authorized!
    const bareAuth = await srv.req(`/api/studio/resource-grants/authority?enterpriseId=${enterpriseId}&projectId=${projOwner.id}&packId=${packId}`, 'GET', undefined, { cookie: '' });
    assert.equal(bareAuth.status, 403, 'Bare cookie-less request MUST NEVER receive grantAuthority!');
    assert.equal(bareAuth.json.code, 'resource_operator_not_authorized');

    // Context B (completely separate browser session, no prior cookie) opens projOwner directly -> mints DISTINCT session:<uuid-B>, CANNOT hijack op:ops-owner!
    const ctxBOpen = await srv.req(`/api/projects/${projOwner.id}`, 'GET', undefined, { cookie: '' });
    assert.equal(ctxBOpen.status, 200);
    const cookieB = ctxBOpen.setCookie.split(';')[0]!;
    assert.ok(cookieB.startsWith('optracall_op_ctx='));
    const ctxBAuth = await srv.req(`/api/studio/resource-grants/authority?enterpriseId=${enterpriseId}&projectId=${projOwner.id}&packId=${packId}`, 'GET', undefined, { cookie: cookieB });
    assert.equal(ctxBAuth.status, 403, 'Separate browser session B opening owner project MUST NOT obtain owner grantAuthority!');

    // Named non-owner operator `store-analyst` also CANNOT hijack op:ops-owner, AND cannot log in as `ops-owner` with wrong passcode!
    const regAnalyst = await srv.req('/api/studio/operators/session', 'POST', {
      action: 'register',
      operatorId: 'store-analyst',
      displayName: '湖庭门店分析师',
      passcode: 'analyst-pass-456',
      activeProjectId: projOwner.id,
    }, { cookie: '' });
    assert.equal(regAnalyst.status, 200);
    const analystCookie = regAnalyst.setCookie.split(';')[0]!;
    const analystAuth = await srv.req(`/api/studio/resource-grants/authority?enterpriseId=${enterpriseId}&projectId=${projOwner.id}&packId=${packId}`, 'GET', undefined, { cookie: analystCookie });
    assert.equal(analystAuth.status, 403, 'Non-owner business operator MUST be rejected from minting owner grantAuthority!');

    const wrongPassLogin = await srv.req('/api/studio/operators/session', 'POST', {
      action: 'login',
      operatorId: 'ops-owner',
      passcode: 'wrong-pass-999',
    }, { cookie: '' });
    assert.equal(wrongPassLogin.status, 403, 'Wrong passcode impersonation attempt MUST return 403!');
    assert.equal(wrongPassLogin.json.code, 'operator_authentication_failed');

    // Authentic `ops-owner` succeeds!
    const ownerAuthRes = await srv.req(`/api/studio/resource-grants/authority?enterpriseId=${enterpriseId}&projectId=${projOwner.id}&packId=${packId}`, 'GET', undefined, { cookie: ownerActiveCookie });
    assert.equal(ownerAuthRes.status, 200);
    const ownerToken = ownerAuthRes.json.grantAuthority.authorityToken;

    // 3. Put mixed CSV, missing-store-column CSV, and raw 010_draw CSV in projConsumer and test GET /api/projects/:id/files/content + natural expiry!
    const mixedCsv = 'account,first_order_date,store\nC01,2026-09-10,湖庭直营店\nC02,2026-09-12,杉岸直营店\nC03,2026-09-15,\n';
    fs.writeFileSync(path.join(projConsumer.rootPath, '020_clean', 'mixed_orders.csv'), mixedCsv);
    fs.writeFileSync(path.join(projConsumer.rootPath, '020_clean', 'no_store.csv'), 'account,first_order_date\nC01,2026-09-10\n');
    fs.writeFileSync(path.join(projConsumer.rootPath, '020_clean', 'unauthorized_other.csv'), 'account,first_order_date,store\nC99,2026-09-10,杉岸直营店\n');
    fs.writeFileSync(path.join(projConsumer.rootPath, '010_draw', 'raw_secret.csv'), 'secret,raw\n1,2\n');

    const openConsumer = await srv.req(`/api/projects/${projConsumer.id}`, 'GET', undefined, { cookie: analystCookie });
    assert.equal(openConsumer.status, 200);
    const consumerCookie = openConsumer.setCookie.split(';')[0]!;

    // Grant short-lived (450ms) single-store detail grant for mixed_orders.csv + no_store.csv
    const validToIso = new Date(Date.now() + 450).toISOString();
    const shortGrant = await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      packId,
      grantorProjectId: projOwner.id,
      authorityToken: ownerToken,
      grantBasis: 'R7 短期湖庭单店授权',
      subjectType: 'project',
      subjectId: projConsumer.id,
      resourceKind: 'detail',
      operations: ['read-detail-recalculate'],
      scope: { stores: ['湖庭直营店'], allowedDataPaths: ['020_clean/mixed_orders.csv', '020_clean/no_store.csv'] },
      validTo: validToIso,
    }, { cookie: ownerActiveCookie });
    assert.equal(shortGrant.status, 200);

    // Download via GET /api/projects/:id/files/content:
    const otherProjectRead = await srv.req(`/api/projects/${projConsumer.id}/files/content?path=020_clean%2Fmixed_orders.csv`, 'GET', undefined, { cookie: ownerActiveCookie });
    assert.equal(otherProjectRead.status, 403);
    assert.equal(otherProjectRead.json.code, 'member_pack_borrower_context_required');
    // - mixed_orders.csv -> 200 with ONLY 湖庭直营店 (C01), NO 杉岸直营店 (C02) and NO blank store (C03)!
    const dlMixed = await srv.req(`/api/projects/${projConsumer.id}/files/content?path=${encodeURIComponent('020_clean/mixed_orders.csv')}`, 'GET', undefined, { cookie: consumerCookie });
    assert.equal(dlMixed.status, 200);
    assert.equal(dlMixed.headers.get('x-optracall-authorized-view'), 'filtered');
    assert.ok(String(dlMixed.json).includes('C01'));
    assert.ok(!String(dlMixed.json).includes('C02'), 'files/content MUST NOT leak unauthorized store C02!');
    assert.ok(!String(dlMixed.json).includes('C03'), 'files/content MUST NOT leak unattributable row C03!');

    // - no_store.csv -> 403 (missing verifiable store column!)
    const dlNoStore = await srv.req(`/api/projects/${projConsumer.id}/files/content?path=${encodeURIComponent('020_clean/no_store.csv')}`, 'GET', undefined, { cookie: consumerCookie });
    assert.equal(dlNoStore.status, 403);

    // - unauthorized_other.csv & 010_draw/raw_secret.csv -> 403
    const dlUnauth = await srv.req(`/api/projects/${projConsumer.id}/files/content?path=${encodeURIComponent('020_clean/unauthorized_other.csv')}`, 'GET', undefined, { cookie: consumerCookie });
    assert.equal(dlUnauth.status, 403);
    const dlDraw = await srv.req(`/api/projects/${projConsumer.id}/files/content?path=${encodeURIComponent('010_draw/raw_secret.csv')}`, 'GET', undefined, { cookie: consumerCookie });
    assert.equal(dlDraw.status, 403);

    // Wait for natural validTo expiry (550ms) -> files/content MUST immediately flip to 403!
    await new Promise(resolve => setTimeout(resolve, 550));
    const dlAfterExpiry = await srv.req(`/api/projects/${projConsumer.id}/files/content?path=${encodeURIComponent('020_clean/mixed_orders.csv')}`, 'GET', undefined, { cookie: consumerCookie });
    assert.equal(dlAfterExpiry.status, 403, 'Naturally expired grant MUST immediately deny files/content download!');

    // 4. R5: Real CaseStore decision revision pinning & historical readback after newer decision revision!
    const caseGoalHost = {
      request: async (route: string, method = 'GET', body?: unknown) => {
        const res = await fetch(`${srv.base}${route}`, {
          method,
          headers: { 'x-optracall-client': '1', 'content-type': 'application/json', origin: 'http://127.0.0.1:4183', cookie: ownerActiveCookie },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        return res;
      },
    };
    const initCaseRes = await srv.req('/api/cases/storage/initialize', 'POST', {}, { cookie: ownerActiveCookie });
    assert.equal(initCaseRes.status, 200);
    const casePayload = await withCaseGoal(caseGoalHost, {
      operationId: randomUUID(),
      title: '湖庭复购口径经营决策 Case',
      description: '核定 2026-10-31 截止日经营决策',
    });
    const caseRes = await srv.req('/api/cases', 'POST', casePayload, { cookie: ownerActiveCookie });
    assert.equal(caseRes.status, 201);
    const caseId = caseRes.json.case.id;
    const linkRes = await srv.req(`/api/cases/${caseId}/projects`, 'POST', {
      operationId: randomUUID(),
      projectId: projOwner.id,
      expectedRevision: caseRes.json.case.revision,
    }, { cookie: ownerActiveCookie });
    assert.ok(linkRes.status >= 200 && linkRes.status < 300);

    // Seed Case decision rev.1 via approved CaseStore interface while Host is cleanly stopped
    const dataRoot = path.join(root, 'data');
    await srv.close();
    const cs1 = new CaseStore({ dataRoot });
    await cs1.init();
    const cs1Status = cs1.getStatus();
    assert.equal(cs1Status.state, 'ready');
    const dec1 = cs1.saveDecisionDraft(
      {
        operationId: randomUUID(),
        caseStoreId: cs1Status.storeId!,
        caseId,
        expectedRevision: 0,
        kind: 'strategy',
        payload: {
          title: '十月截止口径保持复购激励方案',
          proposal: '按 2026-10-31 截止日口径执行湖庭试点激励',
        },
      },
      { actorKind: 'agent', projectId: projOwner.id, taskId: ownerTaskId, requestId: randomUUID(), sessionId: 'sess-r7', toolCallId: 'tool-r7-1' },
    );
    cs1.close();
    const decisionId = dec1.recordId;
    assert.equal(dec1.revision, 1);

    // Restart Host and re-authenticate as persistent named business operator `ops-owner`
    srv = await startTestHost(root);
    const relogin1 = await srv.req('/api/studio/operators/session', 'POST', {
      action: 'login',
      operatorId: 'ops-owner',
      passcode: 'owner-secret-123',
      activeProjectId: projOwner.id,
    }, { cookie: '' });
    assert.equal(relogin1.status, 200);
    const ownerCookieR1 = relogin1.setCookie.split(';')[0]!;

    // Submit feedback pinning original Case decision rev.1
    const fbRes = await srv.req(`/api/studio/enterprise-packs/${packId}/feedback`, 'POST', {
      requestId: randomUUID(),
      projectId: projOwner.id,
      problemKey: 'r7-case-history-pin',
      packVersion: '1.0',
      purposeIds: [],
      title: '核查原 Case 决策历史版本保全',
      category: 'shared_refund_mapping',
      report: {
        projectId: projOwner.id,
        taskId: ownerTaskId,
        sessionId: 'sess-r7',
        messageId: 'msg-r7',
        reportRef: { authority: 'task', id: ownerTaskId, projectId: projOwner.id, taskId: ownerTaskId, version: sha('r7'), sha256: sha('r7'), locator: JSON.stringify({ kind: 'native-reply', sessionId: 'sess-r7', messageId: 'msg-r7' }) },
        originalCaseRef: { caseId, decisionId, decisionRevision: 1, summary: '十月截止口径保持复购激励方案' },
        adoptionBasis: 'clue_only_no_pack_read',
        usedAssetRefs: [],
        taskCutoffAt: '2026-10-31',
        evidenceNote: '保留当时 Case rev.1 决定',
      },
    }, { cookie: ownerCookieR1 });
    assert.equal(fbRes.status, 200);
    const fbId = fbRes.json.feedback.id;

    // Now append a NEWER decision revision rev.2 on the same Case!
    await srv.close();
    const cs2 = new CaseStore({ dataRoot });
    await cs2.init();
    const cs2Status = cs2.getStatus();
    assert.equal(cs2Status.state, 'ready');
    const dec2 = cs2.saveDecisionDraft(
      {
        operationId: randomUUID(),
        caseStoreId: cs2Status.storeId!,
        caseId,
        recordId: decisionId,
        expectedRevision: 1,
        kind: 'strategy',
        payload: {
          title: '十一月更新后的激励方案 rev2',
          proposal: '根据 11-15 新数据调整激励',
        },
      },
      { actorKind: 'agent', projectId: projOwner.id, taskId: ownerTaskId, requestId: randomUUID(), sessionId: 'sess-r7', toolCallId: 'tool-r7-2' },
    );
    cs2.close();
    assert.equal(dec2.revision, 2);

    srv = await startTestHost(root);
    const relogin2 = await srv.req('/api/studio/operators/session', 'POST', {
      action: 'login',
      operatorId: 'ops-owner',
      passcode: 'owner-secret-123',
      activeProjectId: projOwner.id,
    }, { cookie: '' });
    assert.equal(relogin2.status, 200);
    const ownerCookieR2 = relogin2.setCookie.split(';')[0]!;

    // The legacy report field has no native source. Treat the Case claim as unproved.
    const histRes = await srv.req(`/api/studio/enterprise-packs/${packId}/feedback/${fbId}/case-history`, 'GET', undefined, { cookie: ownerCookieR2 });
    assert.equal(histRes.status, 200);
    assert.equal(histRes.json.historicalDecision, null);
    assert.equal(histRes.json.originalCaseRef, null);
  } finally {
    try { await srv.close(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Host Round-8: wide+narrow grant coexistence expiry on same path, restricted files/copy-to-clean/db-link/grants scoping, legacy unbound system anti-takeover, and retroactive feedback Case rev.1 vs rev.2 pinning', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optracall-member-pack-r8-host-'));
  let srv = await startTestHost(root);
  try {
    await srv.req('/api/configuration', 'PUT', {
      name: 'R8 Synthetic',
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1/v1',
      model: 'synthetic-r8',
      apiKey: 'synthetic-only',
    });
    const entRes = await srv.req('/api/studio/enterprises', 'POST', { requestId: randomUUID(), name: '织屿R8' });
    const enterpriseId = entRes.json.id;

    const regOwner = await srv.req('/api/studio/operators/session', 'POST', {
      action: 'register',
      operatorId: 'ops-r8-owner',
      displayName: 'R8 负责人',
      passcode: 'r8-owner-pass',
    });
    assert.equal(regOwner.status, 200);
    const ownerBaseCookie = regOwner.setCookie.split(';')[0]!;

    const ownerProjRes = await srv.req('/api/projects', 'POST', { name: 'R8 建设方', enterpriseId }, { cookie: ownerBaseCookie });
    assert.equal(ownerProjRes.status, 201);
    const projOwner = ownerProjRes.json.project;
    const ownerCookie = ownerProjRes.setCookie.split(';')[0]!;

    const consumerProjRes = await srv.req('/api/projects', 'POST', { name: 'R8 受限消费方A', enterpriseId }, { cookie: ownerCookie });
    assert.equal(consumerProjRes.status, 201);
    const projConsumer = consumerProjRes.json.project;

    const otherConsumerRes = await srv.req('/api/projects', 'POST', { name: 'R8 受限消费方B', enterpriseId }, { cookie: ownerCookie });
    assert.equal(otherConsumerRes.status, 201);
    const projOtherConsumer = otherConsumerRes.json.project;

    const sysRes = await srv.req('/api/studio/systems', 'POST', {
      requestId: randomUUID(), enterpriseId, name: 'R8 体系', projectId: projOwner.id, goal: 'R8 验证', topicTitle: 'R8',
    }, { cookie: ownerCookie });
    assert.equal(sysRes.status, 201);
    const systemId = sysRes.json.system.id;

    const packRes = await srv.req('/api/studio/enterprise-packs', 'POST', {
      requestId: randomUUID(), enterpriseId, systemId, projectId: projOwner.id, domain: 'member-operations', name: 'R8 资产包',
    }, { cookie: ownerCookie });
    assert.equal(packRes.status, 200);
    const packId = packRes.json.pack.id;

    const authRes = await srv.req(`/api/studio/resource-grants/authority?enterpriseId=${enterpriseId}&projectId=${projOwner.id}&packId=${packId}`, 'GET', undefined, { cookie: ownerCookie });
    assert.equal(authRes.status, 200);
    const ownerToken = authRes.json.grantAuthority.authorityToken;

    // 1. Seed mixed_orders.csv + unauthorized_other.csv + 010_draw/raw_secret.csv on projConsumer
    const mixedCsv = [
      'account,first_order_date,repeat_order_id,repeat_order_date,refund_date,full_refund,store',
      'H01,2026-09-02,O-11,2026-09-18,,false,湖庭直营店',
      'S02,2026-09-03,O-22,2026-09-19,,false,杉岸直营店',
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(projConsumer.rootPath, '020_clean', 'mixed_orders.csv'), mixedCsv);
    fs.writeFileSync(path.join(projConsumer.rootPath, '020_clean', 'unauthorized_other.csv'), 'account,store\nX01,杉岸直营店\n');
    fs.writeFileSync(path.join(projConsumer.rootPath, '010_draw', 'raw_secret.csv'), 'raw,secret\n1,2\n');

    // Grant TWO overlapping grants on the SAME path 020_clean/mixed_orders.csv:
    // - Wide grant (湖庭直营店 + 杉岸直营店) expiring in 500ms
    // - Narrow grant (湖庭直营店 ONLY) with NO expiry
    const wideValidTo = new Date(Date.now() + 500).toISOString();
    const wideGrant = await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(), enterpriseId, packId, grantorProjectId: projOwner.id, authorityToken: ownerToken,
      grantBasis: 'R8 短期宽授权（两店）', subjectType: 'project', subjectId: projConsumer.id, resourceKind: 'detail',
      operations: ['read-detail-recalculate'],
      scope: { stores: ['湖庭直营店', '杉岸直营店'], allowedDataPaths: ['020_clean/mixed_orders.csv'] },
      validTo: wideValidTo,
    }, { cookie: ownerCookie });
    assert.equal(wideGrant.status, 200);

    const narrowGrant = await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(), enterpriseId, packId, grantorProjectId: projOwner.id, authorityToken: ownerToken,
      grantBasis: 'R8 长期窄授权（湖庭单店）', subjectType: 'project', subjectId: projConsumer.id, resourceKind: 'detail',
      operations: ['read-detail-recalculate'],
      scope: { stores: ['湖庭直营店'], allowedDataPaths: ['020_clean/mixed_orders.csv'] },
    }, { cookie: ownerCookie });
    assert.equal(narrowGrant.status, 200);

    // Also grant projOtherConsumer so we verify GET /resource-grants?projectId=projConsumer hides other projects' grants!
    const otherGrant = await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(), enterpriseId, packId, grantorProjectId: projOwner.id, authorityToken: ownerToken,
      grantBasis: 'R8 其他消费项目授权', subjectType: 'project', subjectId: projOtherConsumer.id, resourceKind: 'definition',
      operations: ['read-definition'],
      scope: { stores: ['杉岸直营店'] },
    }, { cookie: ownerCookie });
    assert.equal(otherGrant.status, 200);

    const consumerContext = await srv.req(`/api/projects/${projConsumer.id}`, 'GET', undefined, { cookie: '' });
    assert.equal(consumerContext.status, 200);
    const consumerCookie = consumerContext.setCookie.split(';')[0]!;

    // Before wide grant expiry: files/content sees BOTH H01 (湖庭) and S02 (杉岸)!
    const beforeExpiry = await srv.req(`/api/projects/${projConsumer.id}/files/content?path=${encodeURIComponent('020_clean/mixed_orders.csv')}`, 'GET', undefined, { cookie: consumerCookie });
    assert.equal(beforeExpiry.status, 200);
    assert.ok(String(beforeExpiry.json).includes('H01') && String(beforeExpiry.json).includes('S02'), 'Before wide grant expiry, both 湖庭 and 杉岸 MUST be visible');

    // Restricted project GET /files hides 010_draw and unauthorized_other.csv, keeping only mixed_orders.csv!
    const treeRes = await srv.req(`/api/projects/${projConsumer.id}/files`, 'GET', undefined, { cookie: consumerCookie });
    assert.equal(treeRes.status, 200);
    const treeJson = JSON.stringify(treeRes.json.files);
    assert.ok(treeJson.includes('mixed_orders.csv'), 'Authorized mixed_orders.csv MUST appear in filtered file tree');
    assert.ok(!treeJson.includes('unauthorized_other.csv'), 'Unauthorized 020_clean file MUST be hidden from restricted project tree!');
    assert.ok(!treeJson.includes('raw_secret.csv'), '010_draw raw file MUST be hidden from restricted project tree!');

    // Restricted project POST /files/copy-to-clean -> 403!
    const copyRes = await srv.req(`/api/projects/${projConsumer.id}/files/copy-to-clean`, 'POST', { path: '010_draw/raw_secret.csv' }, { cookie: consumerCookie });
    assert.equal(copyRes.status, 403, 'Restricted member-pack project MUST NOT copy 010_draw to 020_clean!');

    // Restricted project GET /db-link/sources -> 403!
    const dbLinkRes = await srv.req(`/api/projects/${projConsumer.id}/db-link/sources`, 'GET', undefined, { cookie: consumerCookie });
    assert.equal(dbLinkRes.status, 403, 'Restricted member-pack project MUST be denied project-scoped db-link HTTP access!');

    // Consumer GET /resource-grants?enterpriseId=...&projectId=projConsumer MUST ONLY see projConsumer's grants (not projOtherConsumer)!
    const consumerGrantsRes = await srv.req(`/api/studio/resource-grants?enterpriseId=${enterpriseId}&projectId=${projConsumer.id}`, 'GET', undefined, { cookie: consumerCookie });
    assert.equal(consumerGrantsRes.status, 200);
    assert.ok(consumerGrantsRes.json.grants.every((g: any) => g.subjectId === projConsumer.id), 'Consumer resource-grants listing MUST NOT leak other projects grants!');

    // Wait 600ms -> wide grant expires while narrow grant remains active on the SAME path!
    await new Promise(resolve => setTimeout(resolve, 600));
    const afterWideExpiry = await srv.req(`/api/projects/${projConsumer.id}/files/content?path=${encodeURIComponent('020_clean/mixed_orders.csv')}`, 'GET', undefined, { cookie: consumerCookie });
    assert.equal(afterWideExpiry.status, 200, 'Narrow grant MUST keep mixed_orders.csv readable after wide grant expires');
    assert.ok(String(afterWideExpiry.json).includes('H01'), 'Narrow-granted 湖庭直营店 MUST stay visible');
    assert.ok(!String(afterWideExpiry.json).includes('S02') && !String(afterWideExpiry.json).includes('杉岸直营店'), 'Expired wide grant store 杉岸直营店 MUST be stripped immediately!');

    // 2. R2: Legacy unbound system anti-takeover under default real-product startup (no resolveOperator)
    const dataRoot = path.join(root, 'data');
    const bindingsPath = path.join(dataRoot, 'member-packs', 'operator-bindings.json');
    await srv.close();
    const originalBindings = fs.readFileSync(bindingsPath);
    const legacyBindings = JSON.parse(originalBindings.toString('utf8'));
    assert.ok(legacyBindings[systemId]);
    delete legacyBindings[systemId];
    fs.writeFileSync(bindingsPath, JSON.stringify(legacyBindings));
    srv = await startTestHost(root);
    // Ephemeral session:* opening projOwner MUST NOT hijack unbound legacy system!
    const ephOpen = await srv.req(`/api/projects/${projOwner.id}`, 'GET', undefined, { cookie: '' });
    assert.equal(ephOpen.status, 200);
    const ephCookie = ephOpen.setCookie.split(';')[0]!;
    const ephAuth = await srv.req(`/api/studio/resource-grants/authority?enterpriseId=${enterpriseId}&projectId=${projOwner.id}&packId=${packId}`, 'GET', undefined, { cookie: ephCookie });
    assert.equal(ephAuth.status, 403, 'Ephemeral session:* MUST NEVER take over an unbound legacy system!');
    await srv.req('/api/studio/enterprise-packs', 'POST', {
      requestId: randomUUID(), enterpriseId, systemId, projectId: projOwner.id, domain: 'member-operations', name: 'R8 资产包',
    }, { cookie: ephCookie });
    const afterEnsure = await srv.req(`/api/studio/resource-grants/authority?enterpriseId=${enterpriseId}&projectId=${projOwner.id}&packId=${packId}`, 'GET', undefined, { cookie: ephCookie });
    assert.equal(afterEnsure.status, 403, 'The existing pack entry cannot establish authority for an unbound legacy owner');
    await srv.close();

    srv = await startTestHost(root, { resolveOperator: () => ({ operatorId: 'op:unmapped', verified: true }) });
    const unmapped = await srv.req(`/api/projects/${projOwner.id}`);
    assert.equal(unmapped.status, 200);
    const unmappedAuth = await srv.req(`/api/studio/resource-grants/authority?enterpriseId=${enterpriseId}&projectId=${projOwner.id}&packId=${packId}`);
    assert.equal(unmappedAuth.status, 403, 'A trusted login without an ownership mapping cannot issue an unbound legacy credential');
    await srv.close();

    srv = await startTestHost(root, { resolveOperator: () => ({ operatorId: 'op:mapped', verified: true, authorityProjectId: projOwner.id }) });
    const mappedAuth = await srv.req(`/api/studio/resource-grants/authority?enterpriseId=${enterpriseId}&projectId=${projOwner.id}&packId=${packId}`);
    assert.equal(mappedAuth.status, 200, 'An explicit original-project authority mapping can qualify a legacy owner');
    await srv.close();
    fs.writeFileSync(bindingsPath, originalBindings);
    srv = await startTestHost(root);


    // 3. R5: Retroactive feedback after Case rev.1 -> rev.2 MUST resolve historical rev.1 (or mark unresolved when post-origin), NEVER pin rev.2!
    const relogin = await srv.req('/api/studio/operators/session', 'POST', {
      action: 'login',
      operatorId: 'ops-r8-owner',
      passcode: 'r8-owner-pass',
      activeProjectId: projOwner.id,
    }, { cookie: '' });
    assert.equal(relogin.status, 200);
    const ownerCookie2 = relogin.setCookie.split(';')[0]!;

    const caseGoalHost = {
      request: async (route: string, method = 'GET', body?: unknown) =>
        fetch(`${srv.base}${route}`, {
          method,
          headers: { 'x-optracall-client': '1', 'content-type': 'application/json', origin: 'http://127.0.0.1:4183', cookie: ownerCookie2 },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        }),
    };
    await srv.req('/api/cases/storage/initialize', 'POST', {}, { cookie: ownerCookie2 });
    const caseRes = await srv.req('/api/cases', 'POST', await withCaseGoal(caseGoalHost, {
      operationId: randomUUID(),
      title: 'R8 历史决策回溯 Case',
      description: '验证 rev.1 -> rev.2 演进后旧回复补提反馈不误记 rev.2',
    }), { cookie: ownerCookie2 });
    assert.equal(caseRes.status, 201);
    const caseId = caseRes.json.case.id;
    await srv.req(`/api/cases/${caseId}/projects`, 'POST', {
      operationId: randomUUID(), projectId: projOwner.id, expectedRevision: caseRes.json.case.revision,
    }, { cookie: ownerCookie2 });

    // Create tasks for T1 retroactive rev.1 pinning and T_early post-origin unresolved test
    const tRetroRes = await srv.req(`/api/projects/${projOwner.id}/tasks`, 'POST', { name: 'R8 补提反馈旧任务' }, { cookie: ownerCookie2 });
    assert.equal(tRetroRes.status, 201);
    const tRetro = tRetroRes.json.task;
    const tEarlyRes = await srv.req(`/api/projects/${projOwner.id}/tasks`, 'POST', { name: 'R8 更早无决策任务' }, { cookie: ownerCookie2 });
    assert.equal(tEarlyRes.status, 201);
    const tEarly = tEarlyRes.json.task;

    // Seed Case rev.1 at T0, then write old reply/report at T1 > T0, then append rev.2 at T2 > T1!
    await srv.close();
    const csA = new CaseStore({ dataRoot });
    await csA.init();
    const dec1 = csA.saveDecisionDraft(
      {
        operationId: randomUUID(),
        caseStoreId: csA.getStatus().storeId!,
        caseId,
        expectedRevision: 0,
        kind: 'strategy',
        payload: { title: 'R8 原决定 rev1', proposal: '十月原口径决定' },
      },
      { actorKind: 'agent', projectId: projOwner.id, taskId: tRetro.id, requestId: randomUUID(), sessionId: 'sess-r8-t1', toolCallId: 'tool-r8-1' },
    );
    csA.close();
    assert.equal(dec1.revision, 1);

    // Wait 50ms -> T1: create a real native-session JSONL reply at T1 (strictly AFTER rev.1, BEFORE rev.2!)
    await new Promise(resolve => setTimeout(resolve, 50));
    const replyTimestamp = new Date().toISOString();
    const msgIdT1 = 'msg-r8-t1';
    const sessionIdT1 = 'sess-r8-t1';
    const tRetroSessionFile = path.join(tRetro.sessionDirectory, `${sessionIdT1}.jsonl`);
    fs.mkdirSync(tRetro.sessionDirectory, { recursive: true });
    fs.writeFileSync(tRetroSessionFile, [
      JSON.stringify({ type: 'session', version: 3, id: sessionIdT1, timestamp: replyTimestamp, cwd: projOwner.rootPath }),
      JSON.stringify({ type: 'message', id: 'u-r8-1', parentId: null, timestamp: replyTimestamp, message: { role: 'user', timestamp: Date.parse(replyTimestamp), content: [{ type: 'text', text: '按 2026-10-31 截止日核查复购' }] } }),
      JSON.stringify({ type: 'message', id: msgIdT1, parentId: 'u-r8-1', timestamp: replyTimestamp, message: { role: 'assistant', timestamp: Date.parse(replyTimestamp), content: [{ type: 'text', text: '旧回复正文：按 2026-10-31 口径核得结果。' }] } }),
    ].join('\n') + '\n');

    const earlyTs = new Date(Date.parse(dec1.createdAt) - 60_000).toISOString();
    const earlySid = 'sess-r8-early';
    const earlyMid = 'msg-r8-early';
    const earlySessionFile = path.join(tEarly.sessionDirectory, `${earlySid}.jsonl`);
    fs.mkdirSync(tEarly.sessionDirectory, { recursive: true });
    fs.writeFileSync(earlySessionFile, [
      JSON.stringify({ type: 'session', version: 3, id: earlySid, timestamp: earlyTs, cwd: projOwner.rootPath }),
      JSON.stringify({ type: 'message', id: 'u-early', parentId: null, timestamp: earlyTs, message: { role: 'user', timestamp: Date.parse(earlyTs), content: [{ type: 'text', text: '早期分析' }] } }),
      JSON.stringify({ type: 'message', id: earlyMid, parentId: 'u-early', timestamp: earlyTs, message: { role: 'assistant', timestamp: Date.parse(earlyTs), content: [{ type: 'text', text: '早期回复（早于 Case rev.1 和 rev.2）' }] } }),
    ].join('\n') + '\n');

    const projStoreSeed = new ProjectStore({ dataRoot, projectsRoot: path.join(root, 'projects') });
    await projStoreSeed.init();
    await projStoreSeed.setSession(projOwner.id, tRetro.id, tRetroSessionFile);
    await projStoreSeed.setSession(projOwner.id, tEarly.id, earlySessionFile);
    await projStoreSeed.close();

    // Wait 50ms -> T2: append Case rev.2 AFTER the old reply!
    await new Promise(resolve => setTimeout(resolve, 50));
    const csB = new CaseStore({ dataRoot });
    await csB.init();
    const dec2 = csB.saveDecisionDraft(
      {
        operationId: randomUUID(),
        caseStoreId: csB.getStatus().storeId!,
        caseId,
        recordId: dec1.recordId,
        expectedRevision: 1,
        kind: 'strategy',
        payload: { title: 'R8 新决定 rev2', proposal: '十一月调整后新决定' },
        references: [{
          relation: 'derived_from', note: null, target: { type: 'source', source: {
            type: 'native-reply', projectId: projOwner.id, taskId: tRetro.id, sessionId: sessionIdT1,
            messageId: msgIdT1, expectedTextSha256: sha('旧回复正文：按 2026-10-31 口径核得结果。'),
          } },
        }],
      },
      { actorKind: 'agent', projectId: projOwner.id, taskId: tRetro.id, requestId: randomUUID(), sessionId: 'sess-r8', toolCallId: 'tool-r8-2' },
    );
    csB.close();
    assert.equal(dec2.revision, 2);

    srv = await startTestHost(root);
    const relogin3 = await srv.req('/api/studio/operators/session', 'POST', {
      action: 'login', operatorId: 'ops-r8-owner', passcode: 'r8-owner-pass', activeProjectId: projOwner.id,
    }, { cookie: '' });
    const ownerCookie3 = relogin3.setCookie.split(';')[0]!;

    // Submit retroactive feedback from the old reply (T1) WITHOUT passing originalCaseRef -> MUST pin rev.1 (NEVER rev.2!)
    const retroFb = await srv.req(`/api/studio/enterprise-packs/${packId}/feedback`, 'POST', {
      requestId: randomUUID(),
      packVersion: '1.0',
      origin: { projectId: projOwner.id, taskId: tRetro.id, sessionId: sessionIdT1, messageId: msgIdT1 },
      problemKey: 'r8-retro-case-rev1',
      title: 'R8 旧回复补提反馈必须回溯原决定 rev.1',
      category: 'shared_refund_mapping',
      evidenceNote: 'Case 升至 rev.2 后从 T1 旧回复补提反馈',
    }, { cookie: ownerCookie3 });
    assert.equal(retroFb.status, 200, JSON.stringify(retroFb.json));
    const pinnedCaseRef = retroFb.json.feedback.reports[0].originalCaseRef;
    assert.equal(pinnedCaseRef?.caseId, caseId);
    assert.equal(pinnedCaseRef?.decisionId, dec1.recordId);
    assert.equal(pinnedCaseRef?.decisionRevision, 1, 'Retroactive feedback from T1 reply MUST pin historical rev.1, NEVER rev.2!');
    assert.equal(pinnedCaseRef?.decisionResolutionStatus, 'pinned');

    const retroHist = await srv.req(`/api/studio/enterprise-packs/${packId}/feedback/${retroFb.json.feedback.id}/case-history`, 'GET', undefined, { cookie: ownerCookie3 });
    assert.equal(retroHist.status, 200);
    assert.equal(retroHist.json.historicalDecision?.revision, 1);
    assert.equal(retroHist.json.latestDecision?.revision, 2);

    // Submit feedback from T_early (BEFORE rev.1 existed, authored by a DIFFERENT task than dec1/dec2) -> MUST mark unresolved_post_origin_revisions (NEVER pin rev.2!)
    const earlyFb = await srv.req(`/api/studio/enterprise-packs/${packId}/feedback`, 'POST', {
      requestId: randomUUID(),
      packVersion: '1.0',
      origin: { projectId: projOwner.id, taskId: tEarly.id, sessionId: earlySid, messageId: earlyMid },
      problemKey: 'r8-early-unresolved',
      title: 'R8 早于多修订演进的旧回复不误记 rev.2',
      category: 'shared_refund_mapping',
      evidenceNote: 'rev.1 与 rev.2 均晚于本回复且非本任务创建，应标记原决策待核',
    }, { cookie: ownerCookie3 });
    assert.equal(earlyFb.status, 200, JSON.stringify(earlyFb.json));
    const earlyCaseRef = earlyFb.json.feedback.reports[0].originalCaseRef;
    assert.equal(earlyCaseRef, undefined, 'A later project link and unrelated decisions do not attach to this earlier reply.');
    const lateExplicit = await srv.req(`/api/studio/enterprise-packs/${packId}/feedback`, 'POST', {
      requestId: randomUUID(),
      origin: { projectId: projOwner.id, taskId: tRetro.id, sessionId: sessionIdT1, messageId: msgIdT1 },
      problemKey: 'r8-late-explicit', title: '较晚的修订不能接管旧 Case', category: 'shared_refund_mapping',
      originalCaseRef: { caseId, decisionId: dec2.recordId, decisionRevision: 2 },
    }, { cookie: ownerCookie3 });
    assert.equal(lateExplicit.status, 409, JSON.stringify(lateExplicit.json));
  } finally {
    try { await srv.close(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});
