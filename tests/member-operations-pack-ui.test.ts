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

test('SemanticContextDetails renders layered member pack directory supply, pinned version, access levels, and independent verification boundary', async () => {
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
                    restrictedDetailNote: '部分门店明细未授权，不可将未授权门店再购当作零',
                  },
                ],
              },
            ],
          },
        },
      },
    ],
  }));
  assert.match(html, /本任务固定的领域资产包目录供给/);
  assert.match(html, /固定版 v1\.0/);
  assert.match(html, /read-definition \/ read-detail-recalculate/);
  assert.match(html, /部分门店明细未授权，不可将未授权门店再购当作零/);
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
