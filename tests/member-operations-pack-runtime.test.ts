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

async function waitIdle(host: Awaited<ReturnType<typeof startTestHost>>, projectId: string, taskId: string) {
  const route = `/api/projects/${projectId}/tasks/${taskId}`;
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const state = await json(await host.request(route));
    if (state.task.lastRun?.status === 'completed' && state.snapshot.status === 'idle') return state;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for task completion');
}

test('Real Pi SDK session enforces Host resource grants on read_input, pins pack v1.0 mid-upgrade while new task discovers v1.1, resolves native reply feedback with dedupe, and verifies refund revision (one changes, one stays)', { timeout: 90_000 }, async t => {
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
  const { project: projStar } = await json(await host.request('/api/projects', 'POST', { name: '星桥门店分析' }), 201);
  const { project: projAud } = await json(await host.request('/api/projects', 'POST', { name: '两店独立复算' }), 201);

  for (const p of [projBuild, projStar, projAud]) {
    await json(await host.request('/api/studio/enterprise-associations', 'POST', { requestId: randomUUID(), kind: 'project', entityId: p.id, enterpriseId }));
  }

  // Write Starbridge & Willowbank detail files into projStar and projAud
  const starCsv = 'account,order_id,order_date,refund_date,full_refund,store\nC07,O-73,2026-09-18,2026-10-02,true,星桥直营店\nC13,O-81,2026-09-20,,false,星桥直营店\n';
  const willowCsv = 'account,order_id,order_date,store\nW01,O-99,2026-09-19,柳岸直营店\n';
  for (const p of [projStar, projAud]) {
    fs.writeFileSync(path.join(p.rootPath, '020_clean', 'starbridge_orders.csv'), starCsv);
    fs.writeFileSync(path.join(p.rootPath, '020_clean', 'willowbank_orders.csv'), willowCsv);
  }

  // Create Studio system + Enterprise Member Pack v1.0
  const { system } = await json(await host.request('/api/studio/systems', 'POST', {
    requestId: randomUUID(), enterpriseId, name: '织屿会员体系', projectId: projBuild.id, goal: '会员运营资产包', topicTitle: '门店复购',
  }), 201);
  const { pack } = await json(await host.request('/api/studio/enterprise-packs', 'POST', {
    requestId: randomUUID(), enterpriseId, systemId: system.id, domain: 'member-operations', name: '织屿会员运营包',
  }));
  const packId = pack.id;

  const refundR3 = { authority: 'studio-source', id: randomUUID(), version: '3', sha256: sha('refund-r3'), title: '销售退款映射 r3' };
  const refundR4 = { authority: 'studio-source', id: refundR3.id, version: '4', sha256: sha('refund-r4'), title: '销售退款映射 r4' };
  const sapM5 = { authority: 'sap-metric', id: 'member-repurchase', version: '1.0.0', sha256: sha('sap-m5'), title: '复购指标 m5' };
  const sapM6 = { authority: 'sap-metric', id: 'member-repurchase', version: '1.1.0', sha256: sha('sap-m6'), title: '复购指标 m6' };

  const { purpose } = await json(await host.request(`/api/studio/enterprise-packs/${packId}/purposes`, 'POST', {
    requestId: randomUUID(), projectId: projBuild.id,
    purposeKey: 'store-first-purchase-30d-repurchase', title: '门店首购后 30 日有效复购率',
    businessQuestion: '9 月星桥首购队列 30 日复购率', subjectUnit: 'brand_account', windowDays: 30,
    scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店'], period: '2026-09', scopeKey: 'lanxian:direct:starbridge:2026-09' },
    tier: 'formal-calculation', businessStatus: 'active', originalGoal: '核算 9 月星桥复购',
    exclusions: ['未成熟观察窗'], completionCriteria: '核清分子分母',
    dependencies: [
      { id: 'dep-refund', role: 'shared-asset', authority: 'studio-source', ref: refundR3, requiredFor: ['formal-calculation'] },
      { id: 'dep-sap', role: 'sap-metric', authority: 'sap-metric', ref: sapM5, requiredFor: ['formal-calculation'] },
    ],
    policyEffectiveFrom: '2026-09-01', dataCutoffAt: '2026-10-31', observationWindowDays: 30, availableHistoryDays: 60,
  }));

  const { preview: prev1 } = await json(await host.request(`/api/studio/enterprise-packs/${packId}/previews`, 'POST', {
    requestId: randomUUID(), projectId: projBuild.id, version: '1.0', purposeIds: [purpose.id],
    policyEffectiveFrom: '2026-09-01', dataCutoffAt: '2026-10-31', summary: '首版发布 v1.0',
  }));
  await json(await host.request(`/api/studio/enterprise-packs/${packId}/confirm`, 'POST', {
    requestId: randomUUID(), projectId: projBuild.id, previewId: prev1.id, fingerprint: prev1.fingerprint,
    confirmedBy: '会员运营负责人',
    moduleReceipts: [
      { requestId: 'P-030', authority: 'shared-asset', targetRef: refundR3, status: 'succeeded', detail: 'r3', purposeIds: [purpose.id] },
      { requestId: 'P-032', authority: 'sap-metric', targetRef: sapM5, status: 'succeeded', detail: 'm5', purposeIds: [purpose.id] },
    ],
  }));

  // Grant Starbridge project ONLY starbridge_orders.csv (NOT willowbank_orders.csv!)
  await json(await host.request('/api/studio/resource-grants', 'POST', {
    requestId: randomUUID(), enterpriseId, grantor: '原权责方', grantBasis: '星桥店长仅读本店明细',
    subjectType: 'project', subjectId: projStar.id, resourceKind: 'detail',
    purposeKeys: ['store-first-purchase-30d-repurchase'],
    operations: ['read-definition', 'read-detail-recalculate'],
    scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店'], allowedDataPaths: ['020_clean/starbridge_orders.csv'] },
  }));

  // Create Task A in projStar -> real Pi session calls studio_assets catalog, read_input(starbridge), read_input(willowbank)!
  const { task: taskA } = await json(await host.request(`/api/projects/${projStar.id}/tasks`, 'POST', { name: '星桥首版复购分析' }), 201);
  let stepA = 0;
  let willowBlocked = false;
  let starAllowed = false;
  let taskACatalogText = '';

  provider.setResponder(context => {
    stepA += 1;
    if (stepA === 1) {
      return { calls: [{ name: 'studio_assets', arguments: { action: 'catalog' } }] };
    }
    if (stepA === 2) {
      taskACatalogText = providerMessageText(context.recentToolResults.at(-1)!.content);
      return { calls: [{ name: 'read_input', arguments: { filename: 'starbridge_orders.csv' } }] };
    }
    if (stepA === 3) {
      const starText = providerMessageText(context.recentToolResults.at(-1)!.content);
      starAllowed = starText.includes('C07') && starText.includes('C13');
      return { calls: [{ name: 'read_input', arguments: { filename: 'willowbank_orders.csv' } }] };
    }
    const willowRes = context.recentToolResults.at(-1)!;
    const willowText = providerMessageText(willowRes.content);
    willowBlocked = willowText.includes('detail_data_path_not_authorized') || willowText.includes('resource_detail_not_authorized');
    return { text: '星桥9月首购队列按v1.0核得3/4；柳岸订单未授权，未当作零。' };
  });

  await json(await host.request(`/api/projects/${projStar.id}/tasks/${taskA.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '请按星桥直营店授权资料核查 9 月门店复购（截止 2026-10-31）。',
  }), 202);
  const stateA = await waitIdle(host, projStar.id, taskA.id);
  assert.equal(starAllowed, true, 'Starbridge task MUST be allowed to read starbridge_orders.csv');
  assert.equal(willowBlocked, true, 'Starbridge task MUST be blocked from reading unauthorized willowbank_orders.csv');
  assert.match(taskACatalogText, /"pinnedVersion":"1\.0"/);
  assert.deepEqual(provider.errors, []);

  // Submit feedback from Task A's real native assistant reply (twice -> deduplicated into ONE feedback item!)
  const assistantMsgA = [...stateA.snapshot.messages].reverse().find((m: any) => m.role === 'assistant' && m.nativeEntryId && m.nativeSessionId);
  assert.ok(assistantMsgA, 'Assistant reply must have native session/entry identity');
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

  // Publish revision v1.1 (refund r3 -> r4, sap m5 -> m6)
  await json(await host.request(`/api/studio/enterprise-packs/${packId}/purposes`, 'POST', {
    requestId: randomUUID(), projectId: projBuild.id,
    purposeKey: 'store-first-purchase-30d-repurchase', title: '门店首购后 30 日有效复购率',
    businessQuestion: '9 月星桥首购队列 30 日复购率', subjectUnit: 'brand_account', windowDays: 30,
    scope: { brand: '岚线', channel: '直营', stores: ['星桥直营店'], period: '2026-09', scopeKey: 'lanxian:direct:starbridge:2026-09' },
    tier: 'formal-calculation', businessStatus: 'active', originalGoal: '核算 9 月星桥复购',
    exclusions: ['未成熟观察窗'], completionCriteria: '核清分子分母',
    dependencies: [
      { id: 'dep-refund', role: 'shared-asset', authority: 'studio-source', ref: refundR4, requiredFor: ['formal-calculation'] },
      { id: 'dep-sap', role: 'sap-metric', authority: 'sap-metric', ref: sapM6, requiredFor: ['formal-calculation'] },
    ],
    policyEffectiveFrom: '2026-09-01', dataCutoffAt: '2026-10-31', observationWindowDays: 30, availableHistoryDays: 60,
  }));
  const { preview: prev2 } = await json(await host.request(`/api/studio/enterprise-packs/${packId}/previews`, 'POST', {
    requestId: randomUUID(), projectId: projBuild.id, version: '1.1', previousVersion: '1.0', purposeIds: [purpose.id],
    policyEffectiveFrom: '2026-09-01', dataCutoffAt: '2026-10-31', summary: '跨月退款修订 v1.1',
  }));
  await json(await host.request(`/api/studio/enterprise-packs/${packId}/confirm`, 'POST', {
    requestId: randomUUID(), projectId: projBuild.id, previewId: prev2.id, fingerprint: prev2.fingerprint,
    confirmedBy: '会员运营负责人',
    moduleReceipts: [
      { requestId: 'P-041', authority: 'shared-asset', targetRef: refundR4, status: 'succeeded', detail: 'r4 跨月原单关联', purposeIds: [purpose.id] },
      { requestId: 'P-043', authority: 'sap-metric', targetRef: sapM6, status: 'succeeded', detail: 'm6 引用 r4', purposeIds: [purpose.id] },
    ],
  }));

  // Verify Task A stays pinned on v1.0, while brand-new independent Task B in projAud discovers & pins v1.1!
  const { task: taskB } = await json(await host.request(`/api/projects/${projAud.id}/tasks`, 'POST', { name: '独立新任务核对新版' }), 201);
  let stepB = 0;
  let taskBCatalogText = '';
  provider.setResponder(context => {
    stepB += 1;
    if (stepB === 1) return { calls: [{ name: 'studio_assets', arguments: { action: 'catalog' } }] };
    taskBCatalogText = providerMessageText(context.recentToolResults[0].content);
    return { text: '独立新任务已查读 v1.1：C07 跨月全额退款排除（应变），C13 有效再购保留（应保留），9 月星桥复购率为 2/4。' };
  });
  await json(await host.request(`/api/projects/${projAud.id}/tasks/${taskB.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '请独立核查 9 月星桥门店复购（截止 2026-10-31），核对 C07 与 C13。',
  }), 202);
  await waitIdle(host, projAud.id, taskB.id);
  assert.match(taskBCatalogText, /"pinnedVersion":"1\.1"/);

  // Confirm Task A pin remained 1.0 and Task B pin is 1.1!
  const finalPack = await json(await host.request(`/api/studio/enterprise-packs/${packId}`));
  const pinA = finalPack.pack.taskPins.find((p: any) => p.taskId === taskA.id);
  const pinB = finalPack.pack.taskPins.find((p: any) => p.taskId === taskB.id);
  assert.equal(pinA.packVersion, '1.0');
  assert.equal(pinB.packVersion, '1.1');
});
