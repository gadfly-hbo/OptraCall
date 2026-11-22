import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, realpath } from 'node:fs/promises';
import { build } from 'rolldown';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const bundle = (async () => {
  const root = new URL('../', import.meta.url).pathname;
  const directory = `${root}.local/member-pack-ui-test`;
  await mkdir(directory, { recursive: true });
  assert.equal(await realpath(directory), directory);
  const plugin = {
    name: 'member-pack-ui-css',
    resolveId(id: string) { if (id.endsWith('.css')) return `\0empty-css:${id}.js`; },
    load(id: string) { if (id.startsWith('\0empty-css:')) return ''; },
  };
  await Promise.all([
    build({ input: `${root}src/host/ui/SemanticContextPanel.tsx`, external: id => id === 'react' || id.startsWith('react/'), output: { format: 'esm', file: `${directory}/semantic-context-panel.mjs` }, transform: { jsx: 'react-jsx' }, plugins: [plugin] }),
    build({ input: `${root}src/host/ui/CapabilitySettings.tsx`, external: id => id === 'react' || id.startsWith('react/'), output: { format: 'esm', file: `${directory}/capability-settings.mjs` }, transform: { jsx: 'react-jsx' }, plugins: [plugin] }),
    build({ input: `${root}src/host/ui/StudioMemberPackPanel.tsx`, external: id => id === 'react' || id.startsWith('react/'), output: { format: 'esm', file: `${directory}/studio-member-pack.mjs` }, transform: { jsx: 'react-jsx' }, plugins: [plugin] }),
  ]);
  const [semantic, capability, memberPack] = await Promise.all([
    // @ts-expect-error Isolated SSR test bundle generated into .local above.
    import('../.local/member-pack-ui-test/semantic-context-panel.mjs'),
    // @ts-expect-error Isolated SSR test bundle generated into .local above.
    import('../.local/member-pack-ui-test/capability-settings.mjs'),
    // @ts-expect-error Isolated SSR test bundle generated into .local above.
    import('../.local/member-pack-ui-test/studio-member-pack.mjs'),
  ]);
  return { semantic, capability, memberPack };
})();

test('SemanticContextDetails renders layered member pack directory supply, exact pinned dependencies, granted stores, authorized summary, default-deny authorization note, pinnedPack read receipt, and independent verification boundary', async () => {
  const { semantic } = await bundle;
  const html = renderToStaticMarkup(createElement(semantic.SemanticContextDetails, {
    view: 'saved',
    lookup: { state: 'idle' },
    records: [
      {
        studio: {
          action: 'catalog',
          stage: 'directory',
          result: {
            memberPacks: [
              {
                packId: '11111111-1111-4111-8111-111111111111',
                packCode: 'PACK-MEM-001',
                name: '织屿服饰 · 会员运营资产包',
                pinnedVersion: '1.0',
                purposes: [
                  {
                    purposeId: 'U-01',
                    title: '门店首购后 30 日有效复购率',
                    tier: 'formal-calculation',
                    accessLevels: ['read-definition', 'read-detail-recalculate'],
                    dataCutoffAt: '2026-10-31',
                    grantedStores: ['星桥直营店'],
                    authorizedSummary: { summaryAssetId: 'SUM-09', summaryVersion: '1', grain: 'store-month' },
                    dependencies: [
                      { id: 'dep-1', role: 'shared-asset', authority: 'sap-method', ref: { authority: 'sap-method', id: 'refund-map', version: '1' } },
                    ],
                    restrictedDetailNote: '部分门店明细未授权，不可将未授权门店再购当作零',
                  },
                ],
              },
              {
                packId: '22222222-2222-4222-8222-222222222222',
                packCode: 'PACK-MEM-002',
                name: '未授权企业包',
                pinnedVersion: null,
                authorizationRequired: true,
                authorizationNote: '新企业会员包需显式配置项目资源授权（定义查阅 / 汇总引用 / 明细重算），仅凭企业归属不自动授予使用权。',
                purposes: [],
              },
            ],
          },
        },
      },
      {
        studio: {
          action: 'read-source',
          stage: 'source',
          complete: true,
          ref: { authority: 'sap-method', id: 'refund-map', version: '1', sha256: 'abc123' },
          body: '退款映射规则正文',
          result: { pinnedPack: { packId: '11111111-1111-4111-8111-111111111111', packVersion: '1.0', purposeIds: ['U-01'] } },
        },
      },
    ],
  }));
  assert.match(html, /本任务固定的领域资产包目录供给/);
  assert.match(html, /固定版 v1\.0/);
  assert.match(html, /read-definition \/ read-detail-recalculate/);
  assert.match(html, /获准门店：星桥直营店/);
  assert.match(html, /获准汇总：SUM-09@1（store-month）/);
  assert.match(html, /固定原依赖：shared-asset:refund-map@1/);
  assert.match(html, /部分门店明细未授权，不可将未授权门店再购当作零/);
  assert.match(html, /新企业会员包需显式配置项目资源授权/);
  assert.match(html, /所属固定包版/);
  assert.match(html, /查实错版即使汇总数字相同也判该用途未通过/);
});

test('CapabilityPlansSettings renders Domain Asset Package registration heading and controls', async () => {
  const { capability } = await bundle;
  const html = renderToStaticMarkup(createElement(capability.CapabilityPlansSettings, { onOpenStudio: () => {} }));
  assert.match(html, /领域资产包/);
  assert.match(html, /登记参考来源/);
  assert.match(html, /进入企业 Studio 建设/);
});

test('StudioMemberPackPanel renders enterprise member pack section cleanly', async () => {
  const { memberPack } = await bundle;
  const html = renderToStaticMarkup(createElement(memberPack.StudioMemberPackPanel, {
    enterpriseId: '11111111-1111-4111-8111-111111111111',
    enterpriseName: '织屿服饰',
    systems: [],
    projects: [],
  }));
  assert.match(html, /企业会员运营资产包/);
  assert.match(html, /同一企业包承接企业线与会员线两条路线/);
});

test('SemanticContextDetails renders same-turn saved report link, exact SHA-256 readback button, independent verification pass verdict, and original Case link (R4/R5)', async () => {
  const { semantic } = await bundle;
  const html = renderToStaticMarkup(createElement(semantic.SemanticContextDetails, {
    view: 'saved',
    lookup: { state: 'idle' },
    records: [],
    onInspectSavedReport: () => {},
    turnEvidence: {
      projectId: '11111111-1111-4111-8111-111111111111',
      taskId: '22222222-2222-4222-8222-222222222222',
      savedReports: [
        { authority: 'task', id: '22222222-2222-4222-8222-222222222222', version: 'a'.repeat(64), sha256: 'a'.repeat(64), locator: '060_reports/repurchase-v1.0.json' },
      ],
      useRecords: [
        {
          packId: '33333333-3333-4333-8333-333333333333',
          packCode: 'PACK-MEM-001',
          packName: '织屿服饰 · 会员运营资产包',
          use: {
            id: '44444444-4444-4444-8444-444444444444',
            packId: '33333333-3333-4333-8333-333333333333',
            projectId: '11111111-1111-4111-8111-111111111111',
            taskId: '22222222-2222-4222-8222-222222222222',
            reportRef: { authority: 'task', id: '22222222-2222-4222-8222-222222222222', version: 'a'.repeat(64), sha256: 'a'.repeat(64), locator: '060_reports/repurchase-v1.0.json' },
            packVersion: '1.0',
            purposeId: 'U-01',
            purposeKey: 'store-first-purchase-30d-repurchase',
            tier: 'formal-calculation',
            accessLevel: 'recalculate',
            catalogSupplied: { packVersion: '1.0', purposeIds: ['U-01'], assetRefs: [], suppliedAt: '2026-11-01T00:00:00Z' },
            actualReads: [],
            independentVerification: {
              status: 'pass',
              verdictDetail: '独立核验任务实读原依赖并通过 3/4 复算核查',
              verifierTaskId: '55555555-5555-4555-8555-555555555555',
              assessmentReportRef: { authority: 'task', id: '55555555-5555-4555-8555-555555555555', version: 'b'.repeat(64), sha256: 'b'.repeat(64), locator: '060_reports/repurchase-v1.0-indep-assess.json' },
              verifierEvidenceSummary: { requiredAssetsCount: 2, readRequiredAssetsCount: 2, allRequiredReadByVerifier: true, hadDataOrCalcEvidence: true },
            },
            createdAt: '2026-11-01T00:00:00Z',
          },
        },
      ],
      feedbackLinks: [
        {
          packId: '33333333-3333-4333-8333-333333333333',
          feedbackId: '66666666-6666-4666-8666-666666666666',
          feedbackCode: 'FB-001',
          title: '跨月退款核查',
          status: 'verified',
          reportRef: { locator: '060_reports/repurchase-v1.0.json', sha256: 'a'.repeat(64) },
          originalCaseRef: { caseId: '77777777-7777-4777-8777-777777777777', summary: 'Q4 湖庭复购经营决策 Case' },
        },
      ],
    },
  }));
  assert.match(html, /本轮已保存报告与独立核验结果/);
  assert.match(html, /060_reports\/repurchase-v1\.0\.json/);
  assert.match(html, /按准确摘要查看原报告/);
  assert.match(html, /独立核验通过/);
  assert.match(html, /核验实读原依赖 2\/2 项/);
  assert.match(html, /060_reports\/repurchase-v1\.0-indep-assess\.json/);
  assert.match(html, /Q4 湖庭复购经营决策 Case/);
});
