// Run against an isolated, configured Host serving the stamped product UI:
//   node tests/browser-strategy-map-import.mjs http://127.0.0.1:<port>
// Drives real UI file upload (setInputFiles) -> official Pi SDK -> propose-map-draft (0 saved versions) ->
// discard -> re-extract -> Sheet 1/2 isolation -> safe dedup -> unknown edge guard ->
// 9% -> 15% manual edit surviving local reread -> one-click v1 save + reload -> multi-source hotspot isolation -> mobile/dark.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { chromium } from 'playwright';

const base = process.argv[2];
const uid = () => crypto.randomUUID();
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base) || [4173, 4174, 4175].includes(Number(new URL(base).port))) {
  throw new Error('Use an isolated Host');
}

async function api(route, method = 'GET', body) {
  const r = await fetch(base + route, {
    method,
    headers: { origin: base, 'x-optracall-client': '1', 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${route} ${r.status} ${await r.text()}`);
  return r.json();
}

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2dIAAAAASUVORK5CYII=';
const TINY_PNG = Buffer.from(TINY_PNG_BASE64, 'base64');

async function buildTwoSheetXlsx() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['目标编号', '目标名称', '基线', '目标值'],
      ['G1', '复购率（新客）', '9%', '18%'],
      ['G2', '复购率（老客）', '18%', '25%'],
    ]),
    '总览表',
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['策略编号', '策略名称', '基线'],
      ['S1', '导购回访（待核指标）', '60%'],
    ]),
    '策略图示页',
  );
  const baseBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  const zip = await JSZip.loadAsync(baseBuf);
  const s2 = await zip.file('xl/worksheets/sheet2.xml').async('string');
  zip.file(
    'xl/worksheets/sheet2.xml',
    s2.replace('</worksheet>', '<drawing r:id="rId1"/></worksheet>').replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '),
  );
  zip.file(
    'xl/worksheets/_rels/sheet2.xml.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
  );
  zip.file(
    'xl/drawings/drawing1.xml',
    '<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>6</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>8</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="5" name="Sheet2Diagram"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdImg1"/></xdr:blipFill></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>',
  );
  zip.file(
    'xl/drawings/_rels/drawing1.xml.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>',
  );
  zip.file('xl/media/image1.png', TINY_PNG);
  return zip.generateAsync({ type: 'nodebuffer' });
}

function msgText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(p => (p && typeof p.text === 'string' ? p.text : '')).join('');
  return '';
}

async function startSyntheticProvider() {
  const state = { mode: 'extract', rereadSaw15: false, requests: 0 };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const reqNum = ++state.requests;
    const messages = body.messages ?? [];
    let lastUser = -1;
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') { lastUser = i; break; }
    const userText = lastUser >= 0 ? msgText(messages[lastUser].content) : '';
    const recentTools = messages.slice(lastUser + 1).filter(m => m.role === 'tool');
    if (userText.includes('workingMapDraft') && userText.includes('"baseline":"15%"')) state.rereadSaw15 = true;

    let src = null;
    const idxIs = userText.indexOf('"importSources":[');
    if (idxIs >= 0) {
      const sub = userText.slice(idxIs + '"importSources":'.length);
      let depth = 0, end = 0;
      for (let i = 0; i < sub.length; i++) {
        if (sub[i] === '[') depth++;
        else if (sub[i] === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
      }
      try { src = JSON.parse(sub.slice(0, end))[0] ?? null; } catch { /* ignore */ }
    }

    let replyText = null;
    let calls = null;
    if (recentTools.length === 0 && src) {
      calls = [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: src.sourceId, page: state.mode === 'reread' ? 2 : 1 } }];
    } else if (recentTools.length === 1 && src) {
      const isReread = state.mode === 'reread';
      calls = [{
        name: 'strategy_goals',
        arguments: {
          action: 'propose-map-draft',
          reason: isReread ? '局部重读 e1 连线' : '多格式导入待核草稿',
          mapDraft: {
            title: 'Q4 会员复购战略地图',
            template: 'bsc',
            choice: '优先导购回访与新客分层培育',
            importSources: [{ sourceId: src.sourceId, fileName: src.fileName, format: src.format, sha256: src.sha256, origin: src.origin, selectedPages: [1, 2] }],
            nodes: [
              { id: 'G1', kind: 'goal', title: '复购率（新客）', perspective: '财务', metric: '90天二购率', baseline: '9%', baselineKind: 'estimated', target: '18%', unit: '%', reviewState: 'clear', sourceLocation: { sourceId: src.sourceId, fileName: src.fileName, page: 1, bbox: [100, 100, 320, 180], label: '总览表 · 新客复购率' } },
              { id: 'G2', kind: 'goal', title: '复购率（老客）', perspective: '客户', metric: '90天复购率', baseline: '18%', baselineKind: 'measured', target: '25%', unit: '%', reviewState: 'clear', sourceLocation: { sourceId: src.sourceId, fileName: src.fileName, page: 1, bbox: [100, 320, 320, 180], label: '总览表 · 老客复购率' } },
              { id: 'S1', kind: 'strategy', title: '导购回访（待核指标）', perspective: '内部流程', metric: '回访覆盖率', baseline: '60%', reviewState: 'needs-review', ambiguityReason: '图上写 60%，源表估算 80%', sourceConflicts: [{ field: 'baseline', values: [{ value: '60%', label: '60%（图示原值）', locationLabel: '策略图示页' }, { value: '80%', label: '80%（源表估算）', locationLabel: '总览表!D4' }] }], sourceLocation: { sourceId: src.sourceId, fileName: src.fileName, page: 2, bbox: [120, 420, 340, 180], label: '策略图示页 · 导购回访' } },
            ],
            edges: [
              { id: 'e1', from: isReread ? 'S1' : 'G1', to: isReread ? 'G1' : 'S1', kind: isReread ? 'supports' : 'unknown', reviewState: isReread ? 'clear' : 'needs-review', ambiguityReason: isReread ? '' : '箭头被水印遮挡，待确认方向与关系', sourceLocation: { sourceId: src.sourceId, fileName: src.fileName, page: 2, arrowBbox: [240, 290, 80, 110], label: '策略图示页 · 连线 e1' } },
            ],
          },
        },
      }];
    } else {
      replyText = '已返回待核草稿，请对照原稿核对后保存。';
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id: `syn-${reqNum}`, object: 'chat.completion.chunk', created: 1, model: body.model ?? 'synthetic', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    send({ role: 'assistant', content: '' });
    if (replyText) send({ content: replyText });
    if (calls) {
      calls.forEach((c, idx) => send({ tool_calls: [{ index: idx, id: `call_${reqNum}_${idx}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } }] }));
      send({}, 'tool_calls');
    } else send({}, 'stop');
    res.write('data: [DONE]\n\n');
    res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  return {
    baseUrl: `http://127.0.0.1:${addr.port}/v1`,
    state,
    close: () => new Promise(resolve => { server.close(() => resolve()); server.closeAllConnections(); }),
  };
}

(async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'optracall-browser-106-'));
  const xlsxPath = path.join(tmpDir, 'Q4战略图_双表.xlsx');
  writeFileSync(xlsxPath, await buildTwoSheetXlsx());

  const provider = await startSyntheticProvider();
  const prevConfigs = await api('/api/configurations');
  const { configuration: synCfg } = await api('/api/configuration', 'PUT', {
    name: '浏览器返工合成模型',
    provider: 'openai-compatible',
    baseUrl: provider.baseUrl,
    model: 'synthetic',
    apiKey: 'synthetic-only',
  });

  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const id = uid();
    const route = `/api/strategy/discussions/${id}`;
    await api('/api/strategy/discussions', 'POST', {
      title: '战略图多格式导入浏览器点验',
      operationId: id,
      configurationId: synCfg.id,
      usageContext: { kind: 'personal', background: '合成战略图对照核对点验' },
    });

    const multiId = uid();
    const multiRoute = `/api/strategy/discussions/${multiId}`;
    await api('/api/strategy/discussions', 'POST', { title: '多来源同页热点隔离验证', operationId: multiId, configurationId: synCfg.id });
    const regA = await api(`${multiRoute}/map-imports`, 'POST', { kind: 'upload', fileName: '白板A.png', bytes: TINY_PNG_BASE64 });
    const regB = await api(`${multiRoute}/map-imports`, 'POST', { kind: 'upload', fileName: '白板B.png', bytes: TINY_PNG_BASE64 });
    await api(`${multiRoute}/maps`, 'POST', {
      mapId: uid(), operationId: uid(), expectedVersion: 0, reason: '双来源同页测试',
      draft: {
        title: '双来源同页测试图', template: 'table',
        importSources: [
          { sourceId: regA.source.sourceId, fileName: '白板A.png', format: 'image', sha256: regA.source.sha256, origin: 'upload', selectedPages: [1] },
          { sourceId: regB.source.sourceId, fileName: '白板B.png', format: 'image', sha256: regB.source.sha256, origin: 'upload', selectedPages: [1] },
        ],
        nodes: [
          { id: 'G1', kind: 'goal', title: '来源A目标', reviewState: 'clear', sourceLocation: { sourceId: regA.source.sourceId, fileName: '白板A.png', page: 1, bbox: [100, 100, 260, 140], label: 'A第1页' } },
          { id: 'G2', kind: 'goal', title: '来源B目标', reviewState: 'clear', sourceLocation: { sourceId: regB.source.sourceId, fileName: '白板B.png', page: 1, bbox: [550, 450, 260, 140], label: 'B第1页' } },
        ],
        edges: [],
      },
    });

    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.setDefaultTimeout(15000);

    await page.goto(base);
    const button = name => page.getByRole('button', { name, exact: true });

    await button('战略选择').click();
    await page.locator('label').filter({ hasText: /^原讨论/ }).locator('select').selectOption(id);
    await button('战略共创').click();
    await button('导入战略图').click();
    await page.getByRole('heading', { name: '导入线下战略图' }).waitFor();

    // 1. Real UI file picker on 2-sheet XLSX + D02 thumbnails + Sheet 1 vs Sheet 2 isolation
    await page.locator('input[type="file"]').setInputFiles(xlsxPath);
    await page.locator('.map-import-thumb-card').first().waitFor();
    assert.equal(await page.locator('.map-import-thumb-card').count(), 2);
    await page.locator('.map-import-thumb-card').nth(1).locator('img.map-import-thumb').waitFor();
    assert.equal(await page.locator('.map-import-thumb-card').nth(0).locator('img.map-import-thumb').count(), 0);

    // 2. Extract via real Pi SDK -> propose-map-draft (0 saved versions!) -> discard -> 0 saved versions!
    provider.state.mode = 'extract';
    await page.getByRole('button', { name: '由原战略 Agent 提取候选' }).click();
    await page.locator('.map-pending-draft-bar').waitFor({ timeout: 25000 });
    assert.equal((await api(`${route}/maps`)).versions.length, 0);

    await page.locator('.map-pending-draft-bar').getByRole('button', { name: '放弃本次草稿', exact: true }).click();
    await page.getByText('已放弃本次导入草稿').waitFor();
    assert.equal((await api(`${route}/maps`)).versions.length, 0);

    // 3. Re-extract -> verify Sheet 1 has NO Sheet 2 image, Sheet 2 shows real image
    await button('导入战略图').click();
    await page.locator('input[type="file"]').setInputFiles(xlsxPath);
    await page.locator('.map-import-thumb-card').first().waitFor();
    await page.getByRole('button', { name: '由原战略 Agent 提取候选' }).click();
    await page.locator('.map-pending-draft-bar').waitFor({ timeout: 25000 });
    await page.getByLabel('原稿对照').waitFor();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.map-source-img').count(), 0);

    await page.getByLabel('候选核对').getByText('S1 · 导购回访（待核指标）').click();
    await page.locator('.map-source-img').waitFor();
    await page.getByRole('button', { name: /采纳 80%/ }).click();

    // 4. Safe advisory dedup preserves 复购率（新客） and 复购率（老客）
    await button('去重检查').click();
    await page.getByText(/未发现重复条目/).waitFor();
    assert.equal(await page.getByLabel('候选核对').locator('tbody').getByText('G1 · 复购率（新客）').count(), 1);
    assert.equal(await page.getByLabel('候选核对').locator('tbody').getByText('G2 · 复购率（老客）').count(), 1);

    // 5. unknown edge disables 确认此连线 and keeps unknown on 翻转方向
    await page.locator('.map-review-edges .map-edge-list li').first().click();
    assert.equal(await page.locator('.map-inspector').getByRole('button', { name: '确认此连线', exact: true }).isDisabled(), true);
    await page.locator('.map-inspector').getByRole('button', { name: /翻转方向/ }).click();
    assert.equal(await page.locator('.map-inspector label').filter({ hasText: '关系类型' }).locator('select').inputValue(), 'unknown');

    // 6. Manual edit 9% -> 15% survives local reread even when Provider returns old 9%
    await page.getByLabel('候选核对').locator('tbody').getByText('G1 · 复购率（新客）').click();
    const baseInput = page.locator('.map-inspector label').filter({ hasText: '基线' }).first().locator('input');
    assert.equal(await baseInput.inputValue(), '9%');
    await baseInput.fill('15%');
    provider.state.mode = 'reread';
    await page.locator('.map-reread-bar input').fill('请局部重读第 2 页被遮挡的箭头 e1');
    await page.locator('.map-reread-bar').getByRole('button', { name: '局部重读', exact: true }).click();
    await page.getByText(/局部重读已合入，你的手工修改已保留/).waitFor({ timeout: 25000 });
    assert.equal(provider.state.rereadSaw15, true);
    await page.getByLabel('候选核对').locator('tbody').getByText('G1 · 复购率（新客）').click();
    assert.equal(await page.locator('.map-inspector label').filter({ hasText: '基线' }).first().locator('input').inputValue(), '15%');
    assert.equal((await api(`${route}/maps`)).versions.length, 0);

    // 7. One-click Save writes v1 once, survives reload without reopening settled draft
    await page.locator('.map-pending-draft-bar').getByRole('button', { name: '保存候选版本', exact: true }).click();
    await page.getByText(/已保存 Q4 会员复购战略地图 · v1/).waitFor();
    const savedVersions = (await api(`${route}/maps`)).versions;
    assert.equal(savedVersions.length, 1);
    assert.equal(savedVersions[0].nodes.find(n => n.id === 'G1').baseline, '15%');
    assert.equal(savedVersions[0].edges[0].kind, 'supports');

    await page.reload();
    await button('战略选择').click();
    await page.locator('label').filter({ hasText: /^原讨论/ }).locator('select').selectOption(id);
    await button('战略地图').click();
    await page.getByLabel('候选核对').waitFor();
    assert.equal(await page.locator('.map-pending-draft-bar').count(), 0);

    // 8. Multi-source same-page hotspot isolation
    await page.locator('label').filter({ hasText: /^原讨论/ }).locator('select').selectOption(multiId);
    await button('战略地图').click();
    await page.locator('.map-source-overlay rect').first().waitFor();
    assert.equal(await page.locator('.map-source-overlay rect').count(), 1);
    assert.equal(await page.locator('.map-source-overlay rect').first().getAttribute('data-hotspot-node'), 'G1');
    await page.getByLabel('切换原稿来源').selectOption(regB.source.sourceId);
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.map-source-overlay rect').count(), 1);
    assert.equal(await page.locator('.map-source-overlay rect').first().getAttribute('data-hotspot-node'), 'G2');

    // 9. Mobile 390x844 + dark mode + zero overflow + 0 pageerrors
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 390, height: 844 });
    await button('查看原稿').click();
    await button('核对候选').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    assert.deepEqual(errors, []);

    console.log('PASS browser-strategy-map-import (real file picker, D02 thumbs, Sheet1/2 isolation, 0-version draft, discard, safe dedup, unknown-edge guard, 15% reread preservation, one-click v1 save + reload, multi-source hotspot isolation, mobile/dark)');
  } finally {
    await browser.close();
    if (prevConfigs.selectedId) {
      await api('/api/configuration/select', 'POST', { id: prevConfigs.selectedId }).catch(() => {});
    }
    await provider.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
