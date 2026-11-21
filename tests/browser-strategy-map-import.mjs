// Run against an isolated, configured Host serving the stamped product UI:
//   node tests/browser-strategy-map-import.mjs http://127.0.0.1:<port>
// Round-3 E2E: existing oldMap v1 + real UI file picker on 2-sheet/2-image XLSX ->
// multi-plan A/B switcher + mid-reread A<->B switch merges late S1->G1/supports & keeps both titles ->
// stale Tab 2 holding old entryB1 rejected with 409 superseded ->
// saved B v1 title edit survives local reread even when Agent omits mapId & produces B v2 ->
// re-clicking already-selected Blue S1 after manually browsing Red jumps back in 1 click ->
// reverse hotspot click -> multi-source isolation -> mobile/dark.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
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

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBuf, data]);
  let crc = 0xffffffff;
  for (let i = 0; i < body.length; i++) crc = CRC_TABLE[(crc ^ body[i]) & 0xff] ^ (crc >>> 8);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([len, body, crcBuf]);
}

function solidPng(w, h, r, g, b) {
  const raw = Buffer.alloc((1 + w * 3) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function buildTwoSheetTwoImageXlsx() {
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
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
  );
  zip.file(
    'xl/drawings/drawing1.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
    <xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <xdr:twoCellAnchor>
        <xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
        <xdr:to><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>6</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
        <xdr:pic><xdr:nvPicPr><xdr:cNvPr id="11" name="RedDiagram"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdImg1"/></xdr:blipFill></xdr:pic>
      </xdr:twoCellAnchor>
      <xdr:twoCellAnchor>
        <xdr:from><xdr:col>6</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
        <xdr:to><xdr:col>10</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>6</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
        <xdr:pic><xdr:nvPicPr><xdr:cNvPr id="12" name="BlueDiagram"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdImg2"/></xdr:blipFill></xdr:pic>
      </xdr:twoCellAnchor>
    </xdr:wsDr>`,
  );
  zip.file(
    'xl/drawings/_rels/drawing1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/red.png"/>
      <Relationship Id="rIdImg2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/blue.png"/>
    </Relationships>`,
  );
  zip.file('xl/media/red.png', solidPng(20, 12, 220, 40, 40));
  zip.file('xl/media/blue.png', solidPng(20, 12, 40, 90, 220));
  return zip.generateAsync({ type: 'nodebuffer' });
}

function msgText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(p => (p && typeof p.text === 'string' ? p.text : '')).join('');
  return '';
}

async function startSyntheticProvider(oldMapId) {
  let releaseGate = () => {};
  let gatePromise = Promise.resolve();
  let signalStarted = () => {};
  let startedPromise = new Promise(resolve => { signalStarted = resolve; });
  const state = {
    mode: 'extract_two_plans',
    rereadSaw15: false,
    rereadSawEditedTitle: false,
    rereadSawTreeTemplate: false,
    rereadLeakedOldMapId: false,
    reviseSawV2Title: false,
    requests: 0,
    armGate() {
      startedPromise = new Promise(resolve => { signalStarted = resolve; });
      gatePromise = new Promise(resolve => { releaseGate = resolve; });
    },
    waitStarted: (ms = 15000) => Promise.race([
      startedPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`waitStarted timed out after ${ms}ms`)), ms)),
    ]),
    release: () => releaseGate(),
  };
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
    const mode = state.mode;

    if (mode === 'reread_plan_b_delayed' && userText.includes('workingMapDraft')) {
      if (userText.includes('"baseline":"15%"')) state.rereadSaw15 = true;
      if (userText.includes('方案 B · 人工确认名称')) state.rereadSawEditedTitle = true;
      if (userText.includes('"template":"tree"')) state.rereadSawTreeTemplate = true;
      if (userText.includes(oldMapId) || userText.includes('旧版门店扩张地图')) state.rereadLeakedOldMapId = true;
    }

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
      if (mode === 'reread_plan_b_delayed') {
        signalStarted();
        await gatePromise;
      }
      calls = [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: src.sourceId, page: mode !== 'extract_two_plans' ? 2 : 1 } }];
    } else if (recentTools.length === 1 && src) {
      const isReread = mode === 'reread_plan_b_delayed' || mode === 'revise_saved_b_omit_id';
      const planBDraft = {
        title: '方案 B · 新客培育',
        template: 'bsc',
        choice: '优先导购回访与新客分层培育',
        importSources: [{ sourceId: src.sourceId, fileName: src.fileName, format: src.format, sha256: src.sha256, origin: src.origin, selectedPages: [1, 2] }],
        nodes: [
          { id: 'G1', kind: 'goal', title: '复购率（新客）', perspective: '财务', metric: '90天二购率', baseline: '9%', baselineKind: 'estimated', target: '18%', unit: '%', reviewState: 'clear', sourceLocation: { sourceId: src.sourceId, fileName: src.fileName, page: 1, bbox: [100, 100, 320, 180], label: '总览表 · 新客复购率' } },
          { id: 'G2', kind: 'goal', title: '复购率（老客）', perspective: '客户', metric: '90天复购率', baseline: '18%', baselineKind: 'measured', target: '25%', unit: '%', reviewState: 'clear', sourceLocation: { sourceId: src.sourceId, fileName: src.fileName, page: 2, objectId: '11', bbox: [120, 120, 320, 200], label: '策略图示页 · 红图 · 老客复购率' } },
          { id: 'S1', kind: 'strategy', title: '导购回访（待核指标）', perspective: '内部流程', metric: '回访覆盖率', baseline: '60%', reviewState: 'needs-review', ambiguityReason: '图上写 60%，源表估算 80%', sourceConflicts: [{ field: 'baseline', values: [{ value: '60%', label: '60%（图示原值）', locationLabel: '策略图示页' }, { value: '80%', label: '80%（源表估算）', locationLabel: '总览表!D4' }] }], sourceLocation: { sourceId: src.sourceId, fileName: src.fileName, page: 2, objectId: '12', bbox: [480, 420, 340, 200], label: '策略图示页 · 蓝图 · 导购回访' } },
        ],
        edges: [
          {
            id: 'e1',
            from: isReread ? 'S1' : 'G1',
            to: isReread ? 'G1' : 'S1',
            kind: isReread ? 'supports' : 'unknown',
            reviewState: isReread ? 'clear' : 'needs-review',
            ambiguityReason: isReread ? '' : '箭头被水印遮挡，待确认方向与关系',
            sourceLocation: { sourceId: src.sourceId, fileName: src.fileName, page: 2, objectId: '12', arrowBbox: [240, 290, 80, 110], label: '策略图示页 · 蓝图 · 连线 e1' },
          },
          {
            id: 'e2',
            from: 'G2',
            to: 'S1',
            kind: 'unknown',
            reviewState: 'needs-review',
            ambiguityReason: '另一条待核连线 e2，方向与关系待人工确认',
            sourceLocation: { sourceId: src.sourceId, fileName: src.fileName, page: 2, objectId: '11', arrowBbox: [200, 310, 80, 90], label: '策略图示页 · 红图 · 连线 e2' },
          },
        ],
      };
      if (isReread) {
        calls = [{ name: 'strategy_goals', arguments: { action: 'propose-map-draft', reason: mode === 'revise_saved_b_omit_id' ? '修订 B v1 重读 e1' : '局部重读方案 B 连线 e1', mapDraft: planBDraft } }];
      } else {
        const planADraft = {
          title: '方案 A · 会员留存',
          template: 'bsc',
          choice: '先保老客复购稳定',
          importSources: [{ sourceId: src.sourceId, fileName: src.fileName, format: src.format, sha256: src.sha256, origin: src.origin, selectedPages: [1, 2] }],
          nodes: [{ id: 'GA1', kind: 'goal', title: '老客留存目标', baseline: '18%', target: '26%', reviewState: 'clear', sourceLocation: { sourceId: src.sourceId, fileName: src.fileName, page: 1, bbox: [100, 100, 300, 140], label: '总览表 · 方案A' } }],
          edges: [],
        };
        calls = [
          { name: 'strategy_goals', arguments: { action: 'propose-map-draft', reason: '方案 A 待核草稿', mapDraft: planADraft } },
          { name: 'strategy_goals', arguments: { action: 'propose-map-draft', reason: '方案 B 待核草稿', mapDraft: planBDraft } },
        ];
      }
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
    close: () => { releaseGate(); return new Promise(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); },
  };
}

(async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'optracall-browser-106-r3-'));
  const xlsxPath = path.join(tmpDir, 'Q4战略图_双表双图.xlsx');
  writeFileSync(xlsxPath, await buildTwoSheetTwoImageXlsx());

  const oldMapId = uid();
  const provider = await startSyntheticProvider(oldMapId);
  const prevConfigs = await api('/api/configurations');
  const { configuration: synCfg } = await api('/api/configuration', 'PUT', {
    name: '三轮浏览器返工合成模型',
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
      title: '战略图多格式导入三轮浏览器点验',
      operationId: id,
      configurationId: synCfg.id,
      usageContext: { kind: 'personal', background: '合成战略图对照核对点验' },
    });
    await api(`${route}/maps`, 'POST', {
      mapId: oldMapId, operationId: uid(), expectedVersion: 0, reason: '历史旧方案',
      draft: { title: '旧版门店扩张地图', template: 'bsc', choice: '旧版选择', nodes: [{ id: 'G0', kind: 'goal', title: '历史旧目标' }], edges: [] },
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

    const ctx1 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx1.newPage();
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

    await page.locator('input[type="file"]').setInputFiles(xlsxPath);
    await page.locator('.map-import-thumb-card').first().waitFor();
    assert.equal(await page.locator('.map-import-thumb-card').count(), 2);
    await page.locator('.map-import-thumb-card').nth(1).locator('img.map-import-thumb').waitFor();
    assert.equal(await page.locator('.map-import-thumb-card').nth(0).locator('img.map-import-thumb').count(), 0);

    provider.state.mode = 'extract_two_plans';
    await page.getByRole('button', { name: '由原战略 Agent 提取候选' }).click();
    await page.locator('.map-draft-switcher').waitFor({ timeout: 25000 });
    assert.equal(await page.locator('.map-draft-switcher button').count(), 2);
    for (let i = 0; i < 80; i++) {
      if (!(await api(route)).busy) break;
      await new Promise(r => setTimeout(r, 100));
    }

    // Open stale Tab 2 holding initial entryB1 (block SSE so Tab 2 remains on stale entryB1 after reread)
    const ctx2 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const tab2 = await ctx2.newPage();
    tab2.on('pageerror', e => errors.push(e.message));
    tab2.setDefaultTimeout(15000);
    await tab2.route('**/events', r => r.abort());
    await tab2.goto(base);
    await tab2.getByRole('button', { name: '战略选择', exact: true }).click();
    await tab2.locator('label').filter({ hasText: /^原讨论/ }).locator('select').selectOption(id);
    await tab2.getByRole('button', { name: '战略地图', exact: true }).click();
    await tab2.locator('.map-draft-switcher button').filter({ hasText: '方案 B' }).click();
    await tab2.locator('.strategy-map h2').filter({ hasText: '方案 B · 新客培育' }).waitFor();
    await tab2.locator('.strategy-map .map-edit-grid label').filter({ hasText: '方案名称' }).locator('input').fill('人工修订：为沉睡会员调整目标');

    // Item 6: Same-sheet Red & Blue isolation + re-click already-selected S1 after manually browsing Red
    await page.locator('.map-draft-switcher button').filter({ hasText: '方案 B' }).click();
    await page.getByLabel('原稿对照').waitFor();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.map-source-img').count(), 0);
    await page.getByLabel('候选核对').locator('tbody').getByText('S1 · 导购回访（待核指标）').click();
    await page.locator('.map-source-overlay[data-active-image-index="2"]').waitFor();
    assert.equal(await page.locator('.map-source-overlay rect[data-hotspot-node="S1"]').count(), 1);
    assert.equal(await page.locator('.map-source-overlay rect[data-hotspot-node="G2"]').count(), 0);
    await page.locator('button[data-sheet-image-index="1"]').click();
    await page.locator('.map-source-overlay[data-active-image-index="1"]').waitFor();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.map-source-overlay[data-active-image-index="1"]').count(), 1);
    await page.getByLabel('候选核对').locator('tbody').getByText('S1 · 导购回访（待核指标）').click();
    await page.locator('.map-source-overlay[data-active-image-index="2"]').waitFor();
    await page.locator('button[data-sheet-image-index="1"]').click();
    await page.locator('.map-source-overlay rect[data-hotspot-node="G2"]').click();
    await page.locator('.map-inspector').getByText('核对条目 · G2').waitFor();

    // Round-4 Item 1 + Round-3 Item 4: Switch A -> edit A -> IMMEDIATELY (0ms wait!) click B -> edit B title & template -> verify B STILL has G1/G2/S1 (never A's GA1!)
    await page.locator('.map-draft-switcher button').filter({ hasText: '方案 A' }).click();
    await page.locator('.strategy-map .map-edit-grid label').filter({ hasText: '方案名称' }).locator('input').fill('方案 A · 人工标题');
    await page.locator('.map-draft-switcher button').filter({ hasText: '方案 B' }).click();
    await page.locator('.strategy-map .map-edit-grid label').filter({ hasText: '方案名称' }).locator('input').fill('方案 B · 人工确认名称');
    await page.locator('.strategy-map .map-edit-grid label').filter({ hasText: '地图模板' }).locator('select').selectOption('tree');
    assert.equal(await page.getByLabel('候选核对').locator('tbody').getByText('GA1 · 老客留存目标').count(), 0);
    await page.getByLabel('候选核对').locator('tbody').getByText('G1 · 复购率（新客）').click();
    await page.locator('.map-inspector label').filter({ hasText: '基线' }).first().locator('input').fill('15%');

    provider.state.mode = 'reread_plan_b_delayed';
    provider.state.armGate();
    await page.locator('.map-reread-bar input').fill('请局部重读第 2 页被遮挡的箭头 e1');
    await page.locator('.map-reread-bar').getByRole('button', { name: '局部重读', exact: true }).click();
    await provider.state.waitStarted();
    await page.locator('.map-draft-switcher button').filter({ hasText: '方案 A' }).click();
    assert.equal(await page.locator('.strategy-map .map-edit-grid label').filter({ hasText: '方案名称' }).locator('input').inputValue(), '方案 A · 人工标题');
    provider.state.release();
    for (let i = 0; i < 120; i++) {
      const d = await api(route);
      if (!d.busy && d.discussion.lastRun?.status === 'completed') break;
      await new Promise(r => setTimeout(r, 150));
    }
    await page.waitForTimeout(400);
    await page.locator('.map-draft-switcher button').filter({ hasText: '方案 B' }).click();
    assert.equal(await page.locator('.strategy-map .map-edit-grid label').filter({ hasText: '方案名称' }).locator('input').inputValue(), '方案 B · 人工确认名称');
    assert.equal(await page.locator('.strategy-map .map-edit-grid label').filter({ hasText: '地图模板' }).locator('select').inputValue(), 'tree');
    await page.locator('.map-review-edges').getByText('S1 → G1').waitFor();
    assert.ok(await page.locator('.map-review-edges').getByText('支持').count() >= 1);
    assert.equal(provider.state.rereadLeakedOldMapId, false);

    // Round-4 Item 3: Stale Tab 2 (with hand-edited title) gets 409 superseded, 0 new maps, preserves manual title + conflict diff + latest S1->G1/支持!
    await tab2.locator('.map-pending-draft-bar').getByRole('button', { name: '保存候选版本', exact: true }).click();
    await tab2.getByText(/已有更新的局部重读结果/).waitFor({ timeout: 15000 });
    assert.equal((await api(`${route}/maps`)).versions.length, 1);
    await tab2.locator('.map-review-edges').getByText('S1 → G1').waitFor();
    assert.equal(await tab2.locator('.strategy-map .map-edit-grid label').filter({ hasText: '方案名称' }).locator('input').inputValue(), '人工修订：为沉睡会员调整目标');
    await tab2.locator('.map-import-notice').getByText(/人工修订：为沉睡会员调整目标/).waitFor();
    await tab2.locator('.map-import-notice').getByText(/方案 B · 新客培育/).waitFor();

    // Tab 1 saves latest Plan B -> v1, dismisses Plan A
    await page.locator('.map-pending-draft-bar').getByRole('button', { name: '保存候选版本', exact: true }).click();
    await page.getByText(/已保存 方案 B · 人工确认名称 · v1/).waitFor();
    const mapsAfterB1 = (await api(`${route}/maps`)).versions;
    const planBV1 = mapsAfterB1.find(v => v.mapId !== oldMapId);
    assert.equal(planBV1.version, 1);
    assert.equal(planBV1.title, '方案 B · 人工确认名称');
    assert.equal(planBV1.template, 'tree');
    assert.deepEqual(planBV1.nodes.map(n => n.id), ['G1', 'G2', 'S1']);
    assert.equal(planBV1.nodes.find(n => n.id === 'G1')?.baseline, '15%');
    assert.equal(planBV1.edges.find(e => e.id === 'e1')?.kind, 'supports');
    assert.equal(await page.locator('.strategy-map .map-edit-grid label').filter({ hasText: '方案名称' }).locator('input').inputValue(), '方案 A · 人工标题');
    await page.locator('.map-pending-draft-bar').getByRole('button', { name: '放弃本次草稿', exact: true }).click();
    await page.getByText('已放弃本次导入草稿').waitFor();

    // Round-5 Item 2 Control A & C (Prompt mentioning S1/G1 + manually flipped e2 still unknown) + Control B (positive 9% adoption)
    const r5aId = uid();
    const r5aRoute = `/api/strategy/discussions/${r5aId}`;
    await api('/api/strategy/discussions', 'POST', { title: '五轮对照A_提示含G1与翻转e2', operationId: r5aId, configurationId: synCfg.id, usageContext: { kind: 'personal', background: '五轮局部重读对照' } });
    await page.locator('label').filter({ hasText: /^原讨论/ }).locator('select').selectOption(r5aId);
    await button('战略共创').click();
    await button('导入战略图').click();
    await page.locator('input[type="file"]').setInputFiles(xlsxPath);
    await page.locator('.map-import-thumb-card').first().waitFor();
    provider.state.mode = 'extract_two_plans';
    await page.getByRole('button', { name: '由原战略 Agent 提取候选' }).click();
    await page.locator('.map-draft-switcher').waitFor({ timeout: 25000 });
    for (let i = 0; i < 80; i++) {
      if (!(await api(r5aRoute)).busy) break;
      await new Promise(r => setTimeout(r, 100));
    }
    await page.locator('.map-draft-switcher button').filter({ hasText: '方案 B' }).click();
    await page.locator('.strategy-map .map-edit-grid label').filter({ hasText: '方案名称' }).locator('input').fill('方案 B · 人工确认名称');
    await page.locator('.strategy-map .map-edit-grid label').filter({ hasText: '地图模板' }).locator('select').selectOption('tree');
    await page.getByLabel('候选核对').locator('tbody').getByText('G1 · 复购率（新客）').click();
    await page.locator('.map-inspector label').filter({ hasText: '基线' }).first().locator('input').fill('15%');
    // Manually flip e2 (G2 -> S1 becomes S1 -> G2) while keeping kind='unknown', leave e1 as unknown -> Save v1!
    await page.locator('.map-review-edges').getByText('G2 → S1').click();
    await page.locator('.map-inspector').getByRole('button', { name: '⇄ 翻转方向' }).click();
    await page.locator('.map-review-edges').getByText('S1 → G2').waitFor();
    await page.locator('.map-pending-draft-bar').getByRole('button', { name: '保存候选版本', exact: true }).click();
    await page.getByText(/已保存 方案 B · 人工确认名称 · v1/).waitFor();
    await page.locator('.map-pending-draft-bar').getByRole('button', { name: '放弃本次草稿', exact: true }).click();
    await page.getByText('已放弃本次导入草稿').waitFor();
    const r5aV1 = (await api(`${r5aRoute}/maps`)).versions[0];
    assert.equal(r5aV1.nodes.find(n => n.id === 'G1')?.baseline, '15%');
    assert.equal(r5aV1.edges.find(e => e.id === 'e1')?.kind, 'unknown');
    assert.equal(r5aV1.edges.find(e => e.id === 'e2')?.from, 'S1');
    assert.equal(r5aV1.edges.find(e => e.id === 'e2')?.to, 'G2');
    assert.equal(r5aV1.edges.find(e => e.id === 'e2')?.kind, 'unknown');

    // FULL PAGE RELOAD -> prompt explicitly mentions S1 & G1 -> reread e1!
    await page.reload();
    await button('战略选择').click();
    await page.locator('label').filter({ hasText: /^原讨论/ }).locator('select').selectOption(r5aId);
    await button('战略地图').click();
    provider.state.mode = 'revise_saved_b_omit_id';
    await page.locator('.map-reread-bar input').fill('请只核对 S1 到 G1 的连线 e1 方向，其余保持原样；保留 G1 的人工基线不变');
    await page.locator('.map-reread-bar').getByRole('button', { name: '局部重读', exact: true }).click();
    await page.locator('.map-pending-draft-bar').waitFor({ timeout: 25000 });
    // e1 directly updated to S1 -> G1 / 支持; G1 baseline stays 15%; flipped e2 stays S1 -> G2 / 未知关系 with explicit conflict diffs!
    assert.equal(await page.locator('.strategy-map .map-edit-grid label').filter({ hasText: '方案名称' }).locator('input').inputValue(), '方案 B · 人工确认名称');
    await page.getByLabel('候选核对').locator('tbody').getByText('G1 · 复购率（新客）').click();
    assert.equal(await page.locator('.map-inspector label').filter({ hasText: '基线' }).first().locator('input').inputValue(), '15%');
    await page.locator('.map-review-edges').getByText('S1 → G1').waitFor();
    await page.locator('.map-review-edges').getByText('S1 → G2').waitFor();
    await page.locator('[data-merge-conflict="saved-node:G1:baseline"]').waitFor();
    await page.locator('[data-merge-conflict="saved-edge:e2"]').waitFor();
    await page.locator('.map-pending-draft-bar').getByRole('button', { name: '保存候选版本', exact: true }).click();
    await page.getByText(/已保存 方案 B · 人工确认名称 · v2/).waitFor();
    const r5aVersions = (await api(`${r5aRoute}/maps`)).versions;
    assert.equal(r5aVersions.length, 2);
    assert.equal(r5aVersions[1].nodes.find(n => n.id === 'G1')?.baseline, '15%');
    assert.equal(r5aVersions[1].edges.find(e => e.id === 'e1')?.kind, 'supports');
    assert.equal(r5aVersions[1].edges.find(e => e.id === 'e2')?.from, 'S1');
    assert.equal(r5aVersions[1].edges.find(e => e.id === 'e2')?.to, 'G2');
    assert.equal(r5aVersions[1].edges.find(e => e.id === 'e2')?.kind, 'unknown');

    // Positive control: user explicitly clicks [改用重读值] on G1 baseline -> adopts 9% and saves v3!
    await page.locator('.map-reread-bar input').fill('再次核对并对比基线');
    await page.locator('.map-reread-bar').getByRole('button', { name: '局部重读', exact: true }).click();
    await page.locator('[data-merge-conflict="saved-node:G1:baseline"]').waitFor({ timeout: 25000 });
    await page.locator('[data-merge-conflict="saved-node:G1:baseline"]').getByRole('button', { name: '改用重读值' }).click();
    await page.getByLabel('候选核对').locator('tbody').getByText('G1 · 复购率（新客）').click();
    assert.equal(await page.locator('.map-inspector label').filter({ hasText: '基线' }).first().locator('input').inputValue(), '9%');
    await page.locator('.map-pending-draft-bar').getByRole('button', { name: '保存候选版本', exact: true }).click();
    await page.getByText(/已保存 方案 B · 人工确认名称 · v3/).waitFor();
    const r5aV3 = (await api(`${r5aRoute}/maps`)).versions.at(-1);
    assert.equal(r5aV3.version, 3);
    assert.equal(r5aV3.nodes.find(n => n.id === 'G1')?.baseline, '9%');
    assert.equal(r5aV3.edges.find(e => e.id === 'e2')?.from, 'S1');

    // Round-5 Item 2 Control D: Delete false node G2 + clear G1 target to '' (待定) -> Save v1 -> FULL PAGE RELOAD -> reread e1 -> G2 does NOT reappear & G1 target stays '' with explicit conflict diffs -> Save v2!
    const r5bId = uid();
    const r5bRoute = `/api/strategy/discussions/${r5bId}`;
    await api('/api/strategy/discussions', 'POST', { title: '五轮对照B_删G2清目标待定', operationId: r5bId, configurationId: synCfg.id, usageContext: { kind: 'personal', background: '五轮删除与留空对照' } });
    await page.locator('label').filter({ hasText: /^原讨论/ }).locator('select').selectOption(r5bId);
    await button('战略共创').click();
    await button('导入战略图').click();
    await page.locator('input[type="file"]').setInputFiles(xlsxPath);
    await page.locator('.map-import-thumb-card').first().waitFor();
    provider.state.mode = 'extract_two_plans';
    await page.getByRole('button', { name: '由原战略 Agent 提取候选' }).click();
    await page.locator('.map-draft-switcher').waitFor({ timeout: 25000 });
    for (let i = 0; i < 80; i++) {
      if (!(await api(r5bRoute)).busy) break;
      await new Promise(r => setTimeout(r, 100));
    }
    await page.locator('.map-draft-switcher button').filter({ hasText: '方案 B' }).click();
    await page.getByLabel('候选核对').locator('tbody').getByText('G2 · 复购率（老客）').click();
    await page.locator('.map-inspector').getByRole('button', { name: '删除误项' }).click();
    await page.getByLabel('候选核对').locator('tbody').getByText('G1 · 复购率（新客）').click();
    await page.locator('.map-inspector label').filter({ hasText: '目标值' }).first().locator('input').fill('');
    await page.locator('.map-pending-draft-bar').getByRole('button', { name: '保存候选版本', exact: true }).click();
    await page.getByText(/已保存 方案 B · 新客培育 · v1/).waitFor();
    await page.locator('.map-pending-draft-bar').getByRole('button', { name: '放弃本次草稿', exact: true }).click();
    await page.getByText('已放弃本次导入草稿').waitFor();
    const r5bV1 = (await api(`${r5bRoute}/maps`)).versions[0];
    assert.deepEqual(r5bV1.nodes.map(n => n.id), ['G1', 'S1']);
    assert.ok(!r5bV1.nodes.find(n => n.id === 'G1')?.target);

    await page.reload();
    await button('战略选择').click();
    await page.locator('label').filter({ hasText: /^原讨论/ }).locator('select').selectOption(r5bId);
    await button('战略地图').click();
    provider.state.mode = 'revise_saved_b_omit_id';
    await page.locator('.map-reread-bar input').fill('请只重读第 2 页连线 e1');
    await page.locator('.map-reread-bar').getByRole('button', { name: '局部重读', exact: true }).click();
    await page.locator('.map-pending-draft-bar').waitFor({ timeout: 25000 });
    await page.locator('.map-review-edges').getByText('S1 → G1').waitFor();
    assert.equal(await page.getByLabel('候选核对').locator('tbody').getByText('G2 · 复购率（老客）').count(), 0);
    await page.locator('[data-merge-conflict="saved-node-add:G2"]').waitFor();
    await page.locator('[data-merge-conflict="saved-node:G1:target"]').waitFor();
    await page.getByLabel('候选核对').locator('tbody').getByText('G1 · 复购率（新客）').click();
    assert.equal(await page.locator('.map-inspector label').filter({ hasText: '目标值' }).first().locator('input').inputValue(), '');
    await page.locator('.map-pending-draft-bar').getByRole('button', { name: '保存候选版本', exact: true }).click();
    await page.getByText(/已保存 方案 B · 新客培育 · v2/).waitFor();
    const r5bV2 = (await api(`${r5bRoute}/maps`)).versions.at(-1);
    assert.equal(r5bV2.version, 2);
    assert.deepEqual(r5bV2.nodes.map(n => n.id), ['G1', 'S1']);
    assert.ok(!r5bV2.nodes.find(n => n.id === 'G1')?.target);
    assert.equal(r5bV2.edges.find(e => e.id === 'e1')?.kind, 'supports');

    // Multi-source isolation + mobile/dark
    await page.locator('label').filter({ hasText: /^原讨论/ }).locator('select').selectOption(multiId);
    await button('战略地图').click();
    await page.locator('.map-source-overlay rect').first().waitFor();
    assert.equal(await page.locator('.map-source-overlay rect').first().getAttribute('data-hotspot-node'), 'G1');
    await page.getByLabel('切换原稿来源').selectOption(regB.source.sourceId);
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.map-source-overlay rect').first().getAttribute('data-hotspot-node'), 'G2');

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 390, height: 844 });
    await button('查看原稿').click();
    await button('核对候选').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    assert.deepEqual(errors, []);

    await ctx2.close();
    await ctx1.close();
    console.log('PASS browser-strategy-map-import Round-5 (0ms A->B edit zero bleed, stale-tab 409 preserves manual title, post-reload reread preserves G1 15% even when prompt mentions S1/G1, keeps flipped unknown e2, keeps deleted G2 & cleared G1 target, positive 9% adoption works, mobile/dark, 0 pageerrors)');
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
