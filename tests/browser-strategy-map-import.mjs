// Run against an isolated, configured Host serving the stamped product UI.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.argv[2];
const uid = () => crypto.randomUUID();
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base) || [4173, 4174, 4175].includes(Number(new URL(base).port))) {
  throw new Error('Use an isolated Host');
}

async function api(path, method = 'GET', body) {
  const r = await fetch(base + path, {
    method,
    headers: { origin: base, 'x-optracall-client': '1', 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
  return r.json();
}

// Minimal 1x1 PNG (valid IHDR + IDAT + IEND)
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2dIAAAAASUVORK5CYII=';

(async () => {
  const id = uid();
  const route = `/api/strategy/discussions/${id}`;
  await api('/api/strategy/discussions', 'POST', {
    title: '战略图多格式导入浏览器点验',
    operationId: id,
    usageContext: { kind: 'personal', background: '合成战略图对照核对点验' },
  });

  const reg = await api(`${route}/map-imports`, 'POST', {
    kind: 'upload',
    fileName: 'Q4战略图白板.png',
    bytes: TINY_PNG_BASE64,
  });
  const sourceId = reg.source.sourceId;

  await api(`${route}/maps`, 'POST', {
    mapId: uid(),
    operationId: uid(),
    expectedVersion: 0,
    reason: '导入白板初稿',
    draft: {
      title: 'Q4 会员复购战略地图',
      template: 'bsc',
      choice: '优先导购回访',
      importSources: [{
        sourceId,
        fileName: reg.source.fileName,
        format: 'image',
        sha256: reg.source.sha256,
        origin: 'upload',
        selectedPages: [1],
      }],
      nodes: [
        {
          id: 'G1',
          kind: 'goal',
          title: '90天复购率提升',
          perspective: '财务',
          metric: '90天二购率',
          baseline: '9%',
          baselineKind: 'estimated',
          target: '待定',
          unit: '%',
          reviewState: 'clear',
          sourceLocation: { sourceId, page: 1, bbox: [100, 100, 320, 180], label: '白板右上角' },
        },
        {
          id: 'S1',
          kind: 'strategy',
          title: '导购回访（待核指标）',
          perspective: '内部流程',
          metric: '回访覆盖率',
          baseline: '60%',
          reviewState: 'needs-review',
          ambiguityReason: '图上写 60%，讨论备注写 80%',
          sourceConflicts: [{
            field: 'baseline',
            values: [
              { value: '60%', label: '60%（白板原图）', locationLabel: '白板中下' },
              { value: '80%', label: '80%（源表估算）', locationLabel: '目标表!D4' },
            ],
          }],
          sourceLocation: { sourceId, page: 1, bbox: [120, 420, 340, 180], label: '白板中下' },
        },
      ],
      edges: [
        {
          id: 'e1',
          from: 'G1',
          to: 'S1',
          kind: 'unknown',
          reviewState: 'needs-review',
          ambiguityReason: '箭头方向被水印遮挡，待确认是策略支撑目标还是反推',
          sourceLocation: { sourceId, page: 1, arrowBbox: [240, 290, 80, 110], label: '中间连线' },
        },
      ],
    },
  });

  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.setDefaultTimeout(7000);

    await page.goto(base);
    const button = name => page.getByRole('button', { name, exact: true });

    // 1. Verify discussion entry button exists alongside ＋ 添加资料
    await button('战略选择').click();
    await page.locator('label').filter({ hasText: /^原讨论/ }).locator('select').selectOption(id);
    await button('战略共创').click();
    await button('导入战略图').waitFor();
    await button('导入战略图').click();
    await page.getByRole('heading', { name: '导入线下战略图' }).waitFor();
    await page.keyboard.press('Escape');

    // 2. Open 战略地图 and verify side-by-side review pane auto-opens for imported map
    await button('战略地图').click();
    await page.getByLabel('原稿对照').waitFor();
    await page.getByLabel('候选核对').waitFor();
    await page.getByRole('button', { name: /一键保留清楚项/ }).click();
    await page.getByText(/已批量保留 1 项清楚内容/).waitFor();

    // 3. Select needs-review node S1, adopt conflict value, flip edge direction, save v2
    await page.getByLabel('候选核对').getByText('S1 · 导购回访（待核指标）').click();
    await page.getByRole('button', { name: /采纳 80%/ }).click();
    await page.locator('.map-review-edges .map-edge-list li').first().click();
    await page.getByRole('button', { name: /翻转方向/ }).click();
    await button('保存为新版本').click();
    await page.getByText(/已保存 Q4 会员复购战略地图 · v2/).waitFor();

    // 4. Toggle collapse review pane and verify clean single-column view
    await button('收起原稿对照').click();
    assert.equal(await page.getByLabel('原稿对照').count(), 0);
    await button('对照原稿核对').click();
    await page.getByLabel('原稿对照').waitFor();

    // 5. Verify 版本与来源 records 多格式导入原稿
    await button('版本与来源').click();
    await page.getByText(/Q4战略图白板\.png · 多格式导入原稿/).waitFor();

    // 6. Verify mobile viewport zero horizontal overflow & pane switching
    await page.setViewportSize({ width: 390, height: 844 });
    await button('战略地图').click();
    await button('查看原稿').click();
    await button('核对候选').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);

    assert.deepEqual(errors, []);
    console.log('PASS browser-strategy-map-import (dual entry, side-by-side review, conflict adopt, edge flip, v2 save, collapse, versions, mobile)');
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
