import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createHost } from '../src/host/server.ts';

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

async function startTestHost(root: string, opts: { memberPackEnabled?: boolean } = {}) {
  const uiPort = 4183;
  const host = createHost({
    cwd: process.cwd(),
    uiPorts: [uiPort],
    transportVersion: 'test',
    dataRoot: path.join(root, 'data'),
    projectsRoot: path.join(root, 'projects'),
    memberPackEnabled: opts.memberPackEnabled,
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

test('Host member operations pack end-to-end: references, panorama, two-route entries, concurrent/cross-project dedupe, partial publication, 3-tier authorization + file isolation, task pinning, feedback->revision->new version, and rollback read-only mode', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optracall-member-pack-host-'));
  const srv = await startTestHost(root);
  try {
    // 1. Register repo built-in Nike T03 & T04 + synthetic member/benchmark refs
    const t03 = await srv.req('/api/studio/domain-references/repo-template', 'POST', { requestId: randomUUID(), templateId: 'T03' });
    assert.equal(t03.status, 200);
    assert.equal(t03.json.record.contentSha256, '8c64c78a30876c8607c5c32af78bed38e7b662b26354828dd3cd1097a15b4895');

    const t04 = await srv.req('/api/studio/domain-references/repo-template', 'POST', { requestId: randomUUID(), templateId: 'T04' });
    assert.equal(t04.status, 200);
    assert.equal(t04.json.record.contentSha256, '49a33bfc8f6be8d21df4b9a1140f1d966705c0554f83c03aefa1fb85a87200b7');

    // Original text readable for verified T03
    const t03Orig = await srv.req(`/api/studio/domain-references/${t03.json.record.id}/original`);
    assert.equal(t03Orig.status, 200);
    assert.equal(t03Orig.json.sha256, '8c64c78a30876c8607c5c32af78bed38e7b662b26354828dd3cd1097a15b4895');

    // Concurrent same-source registration deduplicates into 1 record
    const jnbyPayload = {
      sourceId: 'DAP-BENCH-JNBY-MEMBER-001',
      version: '0.1',
      title: '江南布衣会员标杆研究',
      domain: 'benchmark',
      routes: ['enterprise'],
      maintainer: '研究档案',
      scope: '集团多品牌会员研究',
      evidenceNature: 'third-party-research',
      evidenceRestrictions: ['第三方研究', '媒体转述与分级分歧'],
      locator: 'synthetic://jnby-v0.1.md',
      visibility: 'shared',
      contentBody: 'Synthetic JNBY v0.1 content',
    };
    const [j1, j2] = await Promise.all([
      srv.req('/api/studio/domain-references', 'POST', { requestId: randomUUID(), ...jnbyPayload }),
      srv.req('/api/studio/domain-references', 'POST', { requestId: randomUUID(), ...jnbyPayload, routes: ['domain'] }),
    ]);
    assert.equal(j1.status, 200);
    assert.equal(j2.status, 200);
    assert.equal(j1.json.record.id, j2.json.record.id);

    // Create Enterprise & Projects (Construction A, Analysis B Starbridge-only, Analysis C Auditor, Other Enterprise Project D)
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
    const projOtherEnt = await createProj('其他企业项目', ent2.json.id);

    // Put detail CSV files into projStar and projAud 020_clean
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

    // 2. Ensure Enterprise Pack + Save Panorama
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
    const crossRead = await srv.req(`/api/studio/enterprise-packs/${packId}?projectId=${projOtherEnt.id}`);
    assert.equal(crossRead.status, 403);

    // 3. Concurrent purpose creation from two different projects with same purposeKey+scope deduplicates into ONE purpose!
    const refundR3 = { authority: 'studio-source', id: randomUUID(), version: '3', sha256: sha('refund-r3'), title: '销售退款映射 r3' };
    const memberRuleR1 = { authority: 'studio-source', id: randomUUID(), version: '1', sha256: sha('member-r1'), title: '会员有效购买 r1' };
    const sapM5 = { authority: 'sap-metric', id: 'member-repurchase', version: '1.0.0', sha256: sha('sap-m5'), title: '复购指标 m5' };

    const purposeBody = {
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
      dependencies: [
        { id: 'dep-r', role: 'shared-asset', authority: 'studio-source', ref: refundR3, requiredFor: ['formal-calculation'] },
        { id: 'dep-m', role: 'member-rule', authority: 'studio-source', ref: memberRuleR1, requiredFor: ['definition-reference', 'formal-calculation'] },
        { id: 'dep-s', role: 'sap-metric', authority: 'sap-metric', ref: sapM5, requiredFor: ['formal-calculation'] },
      ],
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
    const [cp1, cp2] = await Promise.all([
      srv.req(`/api/studio/enterprise-packs/${packId}/purposes`, 'POST', { requestId: randomUUID(), projectId: projBuild.id, ...purposeBody }),
      srv.req(`/api/studio/enterprise-packs/${packId}/purposes`, 'POST', { requestId: randomUUID(), projectId: projAud.id, ...purposeBody }),
    ]);
    assert.equal(cp1.status, 200);
    assert.equal(cp2.status, 200);
    assert.equal(cp1.json.purpose.id, cp2.json.purpose.id);
    const calcPurposeId = cp1.json.purpose.id;

    // Also add definition-reference purpose
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
      dependencies: [{ id: 'dep-m-def', role: 'member-rule', authority: 'studio-source', ref: memberRuleR1, requiredFor: ['definition-reference'] }],
      policyEffectiveFrom: '2026-09-01',
      dataCutoffAt: '2026-10-31',
    });
    assert.equal(defPurpose.status, 200);
    const defPurposeId = defPurpose.json.purpose.id;

    // 4. Unified preview + partial publication (SAP unknown suspends calc, def remains eligible) + reconcile
    const prevRes = await srv.req(`/api/studio/enterprise-packs/${packId}/previews`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      version: '1.0',
      purposeIds: [defPurposeId, calcPurposeId],
      decisions: [{ purposeId: calcPurposeId, choiceId: 'cross-store-scope', selectedKey: 'any-direct', decidedBy: '会员运营负责人' }],
      policyEffectiveFrom: '2026-09-01',
      dataCutoffAt: '2026-10-31',
      summary: '首版按用途发布预览',
    });
    assert.equal(prevRes.status, 200);

    const confRes = await srv.req(`/api/studio/enterprise-packs/${packId}/confirm`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      previewId: prevRes.json.preview.id,
      fingerprint: prevRes.json.preview.fingerprint,
      confirmedBy: '会员运营负责人',
      moduleReceipts: [
        { requestId: 'P-030', authority: 'shared-asset', targetRef: refundR3, status: 'succeeded', detail: '退款映射 r3', purposeIds: [calcPurposeId] },
        { requestId: 'P-031', authority: 'member-rule', targetRef: memberRuleR1, status: 'succeeded', detail: '有效购买 r1', purposeIds: [defPurposeId, calcPurposeId] },
        { requestId: 'P-032', authority: 'sap-metric', targetRef: sapM5, status: 'unknown', detail: 'SAP 超时未知', purposeIds: [calcPurposeId] },
      ],
    });
    assert.equal(confRes.status, 200);
    assert.equal(confRes.json.revision.purposeManifests.find((p: any) => p.purposeId === defPurposeId).status, 'eligible');
    assert.equal(confRes.json.revision.purposeManifests.find((p: any) => p.purposeId === calcPurposeId).status, 'suspended');

    const recRes = await srv.req(`/api/studio/enterprise-packs/${packId}/reconcile`, 'POST', {
      requestId: randomUUID(),
      projectId: projBuild.id,
      version: '1.0',
      receipt: { requestId: 'P-032', authority: 'sap-metric', targetRef: sapM5, status: 'succeeded', detail: '原回执证实成功', purposeIds: [calcPurposeId] },
    });
    assert.equal(recRes.status, 200);
    assert.equal(recRes.json.revision.purposeManifests.find((p: any) => p.purposeId === calcPurposeId).status, 'eligible');

    // 5. Grant three-tier resource permissions & verify Host + underlying file boundary enforcement!
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
    const summaryRef = { authority: 'studio-source', id: randomUUID(), version: '1', sha256: sha('sep-summary') };
    await srv.req('/api/studio/resource-grants', 'POST', {
      requestId: randomUUID(),
      enterpriseId,
      grantor: '企业资料原权责方',
      grantBasis: '总部月报引用汇总',
      subjectType: 'project',
      subjectId: projHQ.id,
      resourceKind: 'summary',
      resourceRef: summaryRef,
      purposeKeys: ['store-first-purchase-30d-repurchase'],
      operations: ['read-definition', 'cite-summary'],
      scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店'], periodFrom: '2026-09-01', periodTo: '2026-09-30', grain: 'store-month', summaryAssetId: summaryRef.id, summaryVersion: '1', summaryAuthority: '总部经营分析中心', metricRef: sapM5 },
    });
    await srv.req('/api/studio/resource-grants', 'POST', {
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

    // Check Host-enforced evaluation: projStar cannot read willowbank_orders.csv; projAud can!
    const evalStarOwn = await srv.req('/api/studio/resource-grants/evaluate', 'POST', {
      enterpriseId, subjectId: projStar.id, operation: 'read-detail-recalculate', purposeKey: 'store-first-purchase-30d-repurchase', stores: ['星桥直营店'], dataPath: '020_clean/starbridge_orders.csv',
    });
    assert.equal(evalStarOwn.json.evaluation.allowed, true);
    const evalStarOther = await srv.req('/api/studio/resource-grants/evaluate', 'POST', {
      enterpriseId, subjectId: projStar.id, operation: 'read-detail-recalculate', purposeKey: 'store-first-purchase-30d-repurchase', stores: ['星桥直营店', '柳岸直营店'], dataPath: '020_clean/willowbank_orders.csv',
    });
    assert.equal(evalStarOther.json.evaluation.allowed, false);
    assert.equal(evalStarOther.json.evaluation.neverTreatAsZero, true);

    // Check studio materials endpoint enforces the same authorization on 020_clean files!
    const starMats = await srv.req(`/api/studio/materials?projectId=${projStar.id}`);
    assert.equal(starMats.status, 200);
    const starLocators = starMats.json.materials.map((m: any) => m.ref.locator);
    assert.equal(starLocators.includes('020_clean/starbridge_orders.csv'), true);
    assert.equal(starLocators.includes('020_clean/willowbank_orders.csv'), false);

    // Merchandising (definition-only) sees NO detail 020_clean files in authorized materials!
    const merchMats = await srv.req(`/api/studio/materials?projectId=${projMerch.id}`);
    assert.equal(merchMats.status, 200);
    assert.equal(merchMats.json.materials.filter((m: any) => m.ref.authority === 'data').length, 0);

    // 6. Archive original construction project -> writes from archived project rejected (409), continuation from projAud succeeds on SAME packId!
    const archRes = await srv.req(`/api/projects/${projBuild.id}/archive`, 'POST', {});
    assert.equal(archRes.status, 200);
    const archivedWrite = await srv.req(`/api/studio/enterprise-packs/${packId}/purposes`, 'POST', {
      requestId: randomUUID(), projectId: projBuild.id, ...purposeBody,
    });
    assert.equal(archivedWrite.status, 409);

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
      dependencies: [{ id: 'dep-m-act', role: 'member-rule', authority: 'studio-source', ref: memberRuleR1, requiredFor: ['definition-reference'] }],
    });
    assert.equal(contWrite.status, 200);
    assert.equal(contWrite.json.pack.id, packId);

    // 7. Close host & reopen in rollback read-only mode (--disable-member-pack / memberPackEnabled: false)
    await srv.close();
    const roSrv = await startTestHost(root, { memberPackEnabled: false });
    try {
      const roGet = await roSrv.req(`/api/studio/enterprise-packs/${packId}`);
      assert.equal(roGet.status, 200);
      assert.equal(roGet.json.pack.id, packId);
      assert.equal(roGet.json.readOnlyRollback, true);
      const roWrite = await roSrv.req(`/api/studio/enterprise-packs/${packId}/purposes`, 'POST', {
        requestId: randomUUID(), projectId: projAud.id, ...purposeBody,
      });
      assert.equal(roWrite.status, 409);
      assert.equal(roWrite.json.code, 'enterprise_pack_disabled');
    } finally {
      await roSrv.close();
    }
  } finally {
    try { await srv.close(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});
