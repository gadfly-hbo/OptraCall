import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText, type ToolProviderMessage } from './fixtures/tool-provider.ts';
import { mapDraft, type StrategyMapVersion } from '../src/host/strategy-map-types.ts';

const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63f8cfc000000301010018dd8db00000000049454e44ae426082',
  'hex',
);

async function makeMemberOpsPptx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:sldIdLst>
        <p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/>
        <p:sldId id="258" r:id="rId3"/><p:sldId id="259" r:id="rId4"/>
      </p:sldIdLst>
      <p:sldSz cx="12192000" cy="6858000"/>
    </p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
      <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide3.xml"/>
      <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide4.xml"/>
    </Relationships>`);
  const blank = (t: string) => `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  zip.file('ppt/slides/slide1.xml', blank('封面'));
  zip.file('ppt/slides/slide2.xml', blank('客群现状'));
  zip.file('ppt/slides/slide3.xml', blank('复盘摘要'));
  zip.file('ppt/slides/slide4.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:cNvPr id="10" name="策略S1"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="900000" y="1800000"/><a:ext cx="3600000" cy="1400000"/></a:xfrm></p:spPr>
          <p:txBody><a:p><a:r><a:t>首购后 60–90 天分层培育</a:t></a:r></a:p></p:txBody>
        </p:sp>
        <p:sp><p:nvSpPr><p:cNvPr id="20" name="目标G1"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="7200000" y="1800000"/><a:ext cx="3800000" cy="1400000"/></a:xfrm></p:spPr>
          <p:txBody><a:p><a:r><a:t>提高新客 90 天二购率</a:t></a:r></a:p><a:p><a:r><a:t>约 9%（年度目标待定）</a:t></a:r></a:p></p:txBody>
        </p:sp>
        <p:sp><p:nvSpPr><p:cNvPr id="25" name="策略S2"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="2000000" y="4200000"/><a:ext cx="3200000" cy="1200000"/></a:xfrm></p:spPr>
          <p:txBody><a:p><a:r><a:t>门店企微 1v1 触达</a:t></a:r></a:p></p:txBody>
        </p:sp>
        <p:cxnSp>
          <p:nvCxnSpPr><p:cNvPr id="30" name="连接符S1到G1"/><p:cNvCxnSpPr><a:stCxn id="10" idx="1"/><a:endCxn id="20" idx="3"/></p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr>
          <p:spPr><a:ln><a:tailEnd type="triangle"/></a:ln></p:spPr>
        </p:cxnSp>
      </p:spTree></p:cSld>
    </p:sld>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

function makeSimplePdf(): Buffer {
  const s = 'BT /F1 12 Tf 72 720 Td (East Region Expansion Goal 12) Tj ET';
  const objs = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(s)} >>\nstream\n${s}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  let out = '%PDF-1.4\n';
  const off = [0];
  for (const o of objs) { off.push(Buffer.byteLength(out)); out += o; }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${off.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < off.length; i++) out += String(off[i]).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<< /Size ${off.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'ascii');
}

test('full multi-format import chain: project file reuse, Pi extraction, user edit readback, CAS conflict, revocation, and zero auto-Goal/Case writes', { timeout: 60_000 }, async t => {
  const host = await startTestHost();
  const provider = await startToolProvider();
  t.after(async () => { await host.close(); await provider.close(); });

  async function api(route: string, method = 'GET', body?: unknown, status = 200) {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, `${method} ${route}: ${await r.clone().text()}`);
    return r.json();
  }

  // 1. Configure synthetic text-only model and initialize Case storage
  await api('/api/cases/storage/initialize', 'POST', {});
  const { configuration } = await api('/api/configuration', 'PUT', {
    name: '战略识图合成模型',
    provider: 'openai-compatible',
    baseUrl: provider.baseUrl,
    model: 'synthetic',
    apiKey: 'synthetic-only',
  });

  // 2. Create project and upload a PPTX into 020_clean (for no-reupload reuse!)
  const { project } = await api('/api/projects', 'POST', { name: '零售会员研究', configurationId: configuration.id }, 201);
  const pptxBytes = await makeMemberOpsPptx();
  const uploaded = await api(`/api/projects/${project.id}/files/upload`, 'POST', {
    directory: '020_clean',
    name: '会员运营复盘_2026Q1.pptx',
    content: pptxBytes.toString('base64'),
  }, 201);
  const uploadId = uploaded.file.id as string;

  // 3. Create strategy discussion linked to that project
  const { discussion } = await api('/api/strategy/discussions', 'POST', {
    operationId: randomUUID(),
    title: '会员运营战略导入测试',
    projectId: project.id,
  }, 201);
  const base = `/api/strategy/discussions/${discussion.id}`;

  // 4. List map-imports library: project PPTX appears as reusable without re-upload, and vision reports text-only
  const lib = await api(`${base}/map-imports`);
  assert.equal(lib.vision.supportsImages, false);
  const reusablePptx = lib.reusable.find((f: { uploadId?: string }) => f.uploadId === uploadId);
  assert.ok(reusablePptx, 'project 020_clean PPTX should be listed as reusable');

  // 5. Register project file without re-uploading bytes + preview page 4 + verify byte-exact download
  const regPptx = await api(`${base}/map-imports`, 'POST', { kind: 'project-file', uploadId });
  const pptxSourceId = regPptx.source.sourceId as string;
  assert.equal(regPptx.source.origin, 'project-file');
  assert.equal(regPptx.decoded.pages.length, 4);

  const previewP4 = await api(`${base}/map-imports/${pptxSourceId}/preview?page=4`);
  assert.equal(previewP4.currentPage.page, 4);
  assert.ok(previewP4.currentPage.shapes.some((s: { text: string }) => s.text.includes('首购后 60–90 天分层培育')));

  const downloaded = await api(`${base}/map-imports/${pptxSourceId}/download`);
  assert.equal(Buffer.from(downloaded.bytes, 'base64').equals(pptxBytes), true);

  // Also verify upload & preview for the other 3 formats (xlsx, pdf, png)
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['目标编号', '目标项', '目标值'], ['G1', '毛利率', '18%']]), '目标表');
  const regXlsx = await api(`${base}/map-imports`, 'POST', {
    kind: 'upload',
    fileName: '渠道毛利.xlsx',
    bytes: (XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer).toString('base64'),
  });
  assert.equal(regXlsx.source.format, 'xlsx');

  const regPdf = await api(`${base}/map-imports`, 'POST', {
    kind: 'upload',
    fileName: '区域拓展.pdf',
    bytes: makeSimplePdf().toString('base64'),
  });
  assert.equal(regPdf.source.format, 'pdf');

  const regPng = await api(`${base}/map-imports`, 'POST', {
    kind: 'upload',
    fileName: '白板.png',
    bytes: TINY_PNG.toString('base64'),
  });
  assert.equal(regPng.source.format, 'image');
  const pngPreview = await api(`${base}/map-imports/${regPng.source.sourceId}/preview?page=1`);
  assert.equal(pngPreview.image.available, true);
  assert.equal(pngPreview.image.mimeType, 'image/png');

  // 6. Real Pi SDK turn: read-import-source(page=4) -> save-map with clear + needs-review + unknown edge
  let readReceipt = '';
  provider.setResponder(({ recentToolResults }) => {
    if (recentToolResults.length === 0) {
      return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: pptxSourceId, page: 4 } }] };
    }
    const lastText = providerMessageText(recentToolResults.at(-1)?.content);
    if (recentToolResults.length === 1) {
      readReceipt = lastText;
      const draft = {
        title: '会员运营复盘_2026Q1',
        template: 'table',
        choice: '聚焦新客 90 天二购率提升',
        nodes: [
          {
            id: 'G1', kind: 'goal', title: '提高新客 90 天二购率', perspective: '客户',
            metric: '新客 90 天二购率', baseline: '9%', baselineKind: '估计基线', target: '', unit: '%', period: '2026 年度',
            reviewState: 'clear',
            sourceLocation: { sourceId: pptxSourceId, fileName: '会员运营复盘_2026Q1.pptx', page: 4, objectId: '20', label: '第 4 页 · 目标G1' },
          },
          {
            id: 'S1', kind: 'strategy', title: '首购后 60–90 天分层培育', perspective: '内部流程',
            reviewState: 'clear',
            sourceLocation: { sourceId: pptxSourceId, fileName: '会员运营复盘_2026Q1.pptx', page: 4, objectId: '10', label: '第 4 页 · 策略S1' },
          },
          {
            id: 'S2', kind: 'strategy', title: '门店企微 1v1 触达', perspective: '学习与成长',
            reviewState: 'clear',
            sourceLocation: { sourceId: pptxSourceId, fileName: '会员运营复盘_2026Q1.pptx', page: 4, objectId: '25', label: '第 4 页 · 策略S2' },
          },
        ],
        edges: [
          {
            id: 'E1', from: 'S1', to: 'G1', kind: 'supports', reviewState: 'clear',
            sourceLocation: { sourceId: pptxSourceId, fileName: '会员运营复盘_2026Q1.pptx', page: 4, objectId: '30', label: '第 4 页 · 连接符S1到G1' },
          },
          {
            id: 'E2', from: 'S2', to: 'G1', kind: 'unknown', reviewState: 'needs-review',
            ambiguityReason: '箭头被贴纸遮挡，仅此处待核对',
            sourceLocation: { sourceId: pptxSourceId, fileName: '会员运营复盘_2026Q1.pptx', page: 4, label: '第 4 页 · 遮挡区域' },
          },
        ],
        importSources: [{
          sourceId: pptxSourceId,
          format: 'pptx',
          fileName: '会员运营复盘_2026Q1.pptx',
          sha256: regPptx.source.sha256,
          origin: 'project-file',
          selectedPages: [4],
        }],
      };
      return { calls: [{ name: 'strategy_goals', arguments: { action: 'save-map', mapDraft: draft, reason: '提取第 4 页会员运营战略候选' } }] };
    }
    return { text: '已提取第 4 页候选地图，仅 S2→G1 遮挡箭头待核对。' };
  });

  const beforeSend = await api(base);
  const reqId = randomUUID();
  const msgBody = {
    requestId: reqId,
    expectedRevision: beforeSend.discussion.revision,
    text: '请读取已选的第 4 页并提取可编辑战略地图候选。',
    importSourceIds: [pptxSourceId],
    selectedImportPages: { [pptxSourceId]: [4] },
  };
  await api(`${base}/messages`, 'POST', msgBody, 202);
  // Idempotent duplicate requestId replays without creating a second run/map
  const replayed = await api(`${base}/messages`, 'POST', msgBody, 202);
  assert.equal(replayed.replayed, true);

  for (let i = 0; i < 400; i++) {
    const d = await api(base);
    if (!d.busy && d.discussion.lastRun?.id === reqId) {
      assert.equal(d.discussion.lastRun.status, 'completed');
      break;
    }
    await delay(25);
  }

  // Verify text-only model fallback notice in read-import-source receipt
  assert.match(readReceipt, /text-only-model/);
  assert.match(readReceipt, /首购后 60–90 天分层培育/);

  const catalog1 = await api(`${base}/maps`);
  assert.equal(catalog1.versions.length, 1);
  const v1 = catalog1.versions[0] as StrategyMapVersion;
  assert.equal(v1.nodes.find(n => n.id === 'G1')?.baseline, '9%');
  assert.equal(v1.nodes.find(n => n.id === 'G1')?.baselineKind, '估计基线');
  assert.equal(v1.nodes.find(n => n.id === 'G1')?.target, '');
  assert.equal(v1.edges.find(e => e.id === 'E2')?.kind, 'unknown');
  assert.equal(v1.edges.find(e => e.id === 'E2')?.reviewState, 'needs-review');

  // Verify zero automatic Goal or Case writes
  const goalsAfter = await api('/api/strategy/goals');
  assert.equal(goalsAfter.goals.length, 0);
  const casesAfter = await api('/api/cases');
  assert.equal(casesAfter.cases.length, 0);

  // 7. User edits edge E2 (resolves unknown -> supports, confirmed) and saves v2
  const editedDraft = {
    ...mapDraft(v1),
    edges: v1.edges.map(e => (e.id === 'E2' ? { ...e, kind: 'supports' as const, reviewState: 'confirmed' as const, ambiguityReason: '人工核对确认指向 G1' } : e)),
  };
  const v2 = (await api(`${base}/maps`, 'POST', {
    mapId: v1.mapId,
    expectedVersion: 1,
    operationId: randomUUID(),
    reason: '用户核对并确认 E2 方向',
    draft: editedDraft,
  }, 201)).version as StrategyMapVersion;
  assert.equal(v2.version, 2);
  assert.equal(v2.edges.find(e => e.id === 'E2')?.kind, 'supports');

  // 8. Same original discussion reads back user's v2 edit AND rejects stale Agent write (CAS)
  let staleErr = '';
  provider.setResponder(({ recentToolResults }) => {
    if (!recentToolResults.length) {
      return { calls: [{ name: 'strategy_goals', arguments: { action: 'save-map', mapId: v1.mapId, expectedVersion: 1, mapDraft: mapDraft(v1), reason: '过期写入测试' } }] };
    }
    staleErr = providerMessageText(recentToolResults.at(-1)?.content);
    return { text: '检测到冲突，已保留人工修改。' };
  });
  const before2 = await api(base);
  const req2 = randomUUID();
  const offset = provider.requests.length;
  await api(`${base}/messages`, 'POST', { requestId: req2, expectedRevision: before2.discussion.revision, text: '核对刚才改完的连线。' }, 202);
  for (let i = 0; i < 400; i++) {
    const d = await api(base);
    if (!d.busy && d.discussion.lastRun?.id === req2) { assert.equal(d.discussion.lastRun.status, 'completed'); break; }
    await delay(25);
  }
  const promptText = providerMessageText(provider.requests[offset]!.body.messages?.filter(m => m.role === 'user').at(-1)?.content);
  assert.match(promptText, /人工核对确认指向 G1/);
  assert.match(staleErr, /strategy_map_version_conflict/);
  assert.equal((await api(`${base}/maps`)).versions.length, 2);

  // 9. Revocation blocks preview, download, future message dispatch, and marks dependent map unavailable
  await api(`${base}/map-imports/${pptxSourceId}/revoke`, 'POST', {});
  await api(`${base}/map-imports/${pptxSourceId}/preview?page=4`, 'GET', undefined, 403);
  await api(`${base}/map-imports/${pptxSourceId}/download`, 'GET', undefined, 403);
  const before3 = await api(base);
  await api(`${base}/messages`, 'POST', {
    requestId: randomUUID(),
    expectedRevision: before3.discussion.revision,
    text: '撤权后尝试重读',
    importSourceIds: [pptxSourceId],
  }, 403);
  const afterRevokeMaps = await api(`${base}/maps`);
  assert.equal(afterRevokeMaps.versions.length, 0);
  assert.equal(afterRevokeMaps.unavailable.length, 2);
  assert.match(afterRevokeMaps.unavailable[0].reason, /strategy_map_import_revoked/);
});

test('multi-format import supports discussion attachment reuse, persists edits across host restart, and handles cancellation safely', { timeout: 60_000 }, async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), 'optracall-import-reopen-data-'));
  const projectsRoot = mkdtempSync(path.join(os.tmpdir(), 'optracall-import-reopen-proj-'));
  t.after(() => {
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(projectsRoot, { recursive: true, force: true });
  });

  let host = await startTestHost({ dataRoot, projectsRoot });
  const provider = await startToolProvider();
  t.after(async () => { await host.close().catch(() => {}); await provider.close(); });

  const api = async (route: string, method = 'GET', body?: unknown, status = 200) => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, `${method} ${route}: ${await r.clone().text()}`);
    return r.json();
  };

  await api('/api/configuration', 'PUT', {
    name: '重开与取消测试模型',
    provider: 'openai-compatible',
    baseUrl: provider.baseUrl,
    model: 'synthetic',
    apiKey: 'synthetic-only',
  });
  const { discussion } = await api('/api/strategy/discussions', 'POST', { operationId: randomUUID(), title: '附件复用与重开' }, 201);
  const base = `/api/strategy/discussions/${discussion.id}`;

  // Upload a PDF as an ordinary discussion attachment, then reuse it for map-import without re-uploading bytes
  const pdfBytes = makeSimplePdf();
  const att = (await api(`${base}/attachments`, 'POST', {
    name: '区域规划.pdf',
    content: pdfBytes.toString('base64'),
    expectedRevision: discussion.revision,
  })).source;
  const updated = (await api(base, 'PATCH', { sources: [att], expectedRevision: discussion.revision })).discussion;

  const lib = await api(`${base}/map-imports`);
  assert.ok(lib.reusable.some((r: { attachmentSourceId?: string }) => r.attachmentSourceId === att.id));

  const reg = await api(`${base}/map-imports`, 'POST', { kind: 'attachment', attachmentSourceId: att.id });
  const srcId = reg.source.sourceId as string;
  assert.equal(reg.source.origin, 'discussion-attachment');

  // Cancellation: provider holds response, user calls /stop -> zero partial map created
  provider.setResponder(() => ({ hold: true }));
  const cancelReqId = randomUUID();
  await api(`${base}/messages`, 'POST', {
    requestId: cancelReqId,
    expectedRevision: updated.revision,
    text: '开始提取但马上取消',
    importSourceIds: [srcId],
  }, 202);
  await provider.waitForRequests(1);
  await api(`${base}/stop`, 'POST', { expectedRequestId: cancelReqId });
  for (let i = 0; i < 300; i++) {
    const d = await api(base);
    if (!d.busy) break;
    await delay(25);
  }
  assert.equal((await api(`${base}/maps`)).versions.length, 0);

  // Now extract & save a map, manually edit it, restart Host, and verify full readback
  provider.setResponder(({ recentToolResults }) => {
    if (!recentToolResults.length) {
      return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: srcId, page: 1 } }] };
    }
    if (recentToolResults.length === 1) {
      return {
        calls: [{
          name: 'strategy_goals',
          arguments: {
            action: 'save-map',
            reason: 'PDF 提取初稿',
            mapDraft: {
              title: '区域拓展候选',
              template: 'table',
              nodes: [{ id: 'G1', kind: 'goal', title: '华东新开 12 家标准店', target: '12', unit: '家', reviewState: 'clear', sourceLocation: { sourceId: srcId, page: 1, label: '第 1 页' } }],
              edges: [],
              importSources: [{ sourceId: srcId, format: 'pdf', fileName: '区域规划.pdf', sha256: reg.source.sha256, origin: 'discussion-attachment', selectedPages: [1] }],
            },
          },
        }],
      };
    }
    return { text: '已保存 PDF 提取初稿。' };
  });

  const beforeExtract = await api(base);
  const reqExtract = randomUUID();
  await api(`${base}/messages`, 'POST', {
    requestId: reqExtract,
    expectedRevision: beforeExtract.discussion.revision,
    text: '提取 PDF 候选',
    importSourceIds: [srcId],
    replacePendingRequestId: beforeExtract.discussion.pendingInput?.requestId,
  }, 202);
  for (let i = 0; i < 400; i++) {
    const d = await api(base);
    if (!d.busy && d.discussion.lastRun?.id === reqExtract) { assert.equal(d.discussion.lastRun.status, 'completed'); break; }
    await delay(25);
  }
  const v1 = (await api(`${base}/maps`)).versions[0] as StrategyMapVersion;
  const v2 = (await api(`${base}/maps`, 'POST', {
    mapId: v1.mapId,
    expectedVersion: 1,
    operationId: randomUUID(),
    reason: '人工调整为 15 家',
    draft: { ...mapDraft(v1), nodes: [{ ...v1.nodes[0]!, target: '15', reviewState: 'confirmed' }] },
  }, 201)).version as StrategyMapVersion;
  assert.equal(v2.version, 2);

  // Restart Host on the exact same dataRoot + projectsRoot
  await host.close();
  host = await startTestHost({ dataRoot, projectsRoot });

  const afterRestart = await api(`${base}/maps`);
  assert.equal(afterRestart.versions.length, 2);
  assert.equal(afterRestart.versions[1].nodes[0].target, '15');
  assert.equal(afterRestart.versions[1].importSources[0].sourceId, srcId);
  const dlAfter = await api(`${base}/map-imports/${srcId}/download`);
  assert.equal(Buffer.from(dlAfter.bytes, 'base64').equals(pdfBytes), true);
});

const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAgAAAQABAAD/wAARCAACAAIDAREAAhEBAxEB/9sAQwAFAwQEBAMFBAQEBQUFBgcMCAcHBwcPCwsJDBEPEhIRDxERExYcFxMUGhURERghGBodHR8fHxMXIiQiHiQcHh8e/9sAQwEFBQUHBgcOCAgOHhQRFB4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4e/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD2j4WaVpc/wx8Kzz6bZyyyaLZu7vApZmMKEkkjkn1r+aeP6k8NxXmdGi3GEcRWSS0SSqSSSS0SS0SWxrHJcuxaWIxGHhOc/elKUYtyb1bbau23q29Wz//Z',
  'base64',
);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBuf, data]);
  let crc = 0xffffffff;
  for (let i = 0; i < body.length; i++) crc = CRC_TABLE[(crc ^ body[i]!) & 0xff]! ^ (crc >>> 8);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([len, body, crcBuf]);
}

function makeLargeValidPng(width: number, height: number): Buffer {
  const stride = 1 + width * 3;
  const raw = randomBytes(stride * height);
  for (let y = 0; y < height; y++) raw[y * stride] = 0; // PNG filter type 0 (None)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const idat = deflateSync(raw, { level: 0 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function makeTwoSheetXlsxWithSheet2Image(): Promise<Buffer> {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['目标编号', '目标名称'], ['G1', '第一页纯表格指标']]), '总览表');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['策略编号', '策略名称'], ['S2', '第二页带内嵌图']]), '策略图示页');
  const baseBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
  const zip = await JSZip.loadAsync(baseBuf);
  const sheet2Xml = await zip.file('xl/worksheets/sheet2.xml')!.async('string');
  zip.file('xl/worksheets/sheet2.xml', sheet2Xml.replace('</worksheet>', '<drawing r:id="rId1"/></worksheet>').replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '));
  zip.file('xl/worksheets/_rels/sheet2.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
    </Relationships>`);
  zip.file('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <xdr:twoCellAnchor>
        <xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
        <xdr:to><xdr:col>6</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>8</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
        <xdr:pic><xdr:nvPicPr><xdr:cNvPr id="5" name="Sheet2Diagram"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdImg1"/></xdr:blipFill></xdr:pic>
      </xdr:twoCellAnchor>
    </xdr:wsDr>`);
  zip.file('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
    </Relationships>`);
  zip.file('xl/media/image1.png', TINY_PNG);
  return zip.generateAsync({ type: 'nodebuffer' });
}

function collectProviderImageUrls(messages: readonly ToolProviderMessage[]): string[] {
  const urls: string[] = [];
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part && typeof part === 'object' && (part as { type?: string }).type === 'image_url') {
        const url = (part as { image_url?: { url?: string } }).image_url?.url;
        if (typeof url === 'string') urls.push(url);
      }
    }
  }
  return urls;
}

function parseToolJson(content: unknown): any {
  const raw = providerMessageText(content).trim();
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(raw.slice(0, i + 1));
    }
  }
  return JSON.parse(raw);
}

async function waitForRun(api: (route: string, method?: string, body?: unknown, status?: number) => Promise<any>, base: string, reqId: string) {
  for (let i = 0; i < 600; i++) {
    const d = await api(base);
    if (!d.busy && d.discussion.lastRun?.id === reqId) return d;
    await delay(25);
  }
  throw new Error(`Timed out waiting for run ${reqId}`);
}

test('Item 1: strict turn-scoped importSourceIds and selectedImportPages enforcement', { timeout: 60_000 }, async t => {
  const host = await startTestHost();
  const provider = await startToolProvider();
  t.after(async () => { await host.close(); await provider.close(); });
  const api = async (route: string, method = 'GET', body?: unknown, status = 200) => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, `${method} ${route}: ${await r.clone().text()}`);
    return r.json();
  };

  await api('/api/configuration', 'PUT', {
    name: '选页隔离测试模型',
    provider: 'openai-compatible',
    baseUrl: provider.baseUrl,
    model: 'synthetic',
    apiKey: 'synthetic-only',
  });
  const { discussion } = await api('/api/strategy/discussions', 'POST', { operationId: randomUUID(), title: '选页范围隔离' }, 201);
  const base = `/api/strategy/discussions/${discussion.id}`;

  const regA = await api(`${base}/map-imports`, 'POST', {
    kind: 'upload',
    fileName: '四页汇报.pptx',
    bytes: (await makeMemberOpsPptx()).toString('base64'),
  });
  const srcA = regA.source.sourceId as string;

  const regB = await api(`${base}/map-imports`, 'POST', {
    kind: 'upload',
    fileName: '另一份材料.pdf',
    bytes: makeSimplePdf().toString('base64'),
  });
  const srcB = regB.source.sourceId as string;

  // HTTP /messages rejects out-of-range page and page map for unselected source
  const d0 = await api(base);
  await api(`${base}/messages`, 'POST', {
    requestId: randomUUID(),
    expectedRevision: d0.discussion.revision,
    text: '无效页码',
    importSourceIds: [srcA],
    selectedImportPages: { [srcA]: [99] },
  }, 400);
  await api(`${base}/messages`, 'POST', {
    requestId: randomUUID(),
    expectedRevision: d0.discussion.revision,
    text: '未授权来源页码',
    importSourceIds: [srcA],
    selectedImportPages: { [srcB]: [1] },
  }, 400);

  // Turn 1: only srcA page [4] authorized
  const turn1Results: string[] = [];
  let turn1Step = 0;
  provider.setResponder(({ messages }) => {
    const toolMsgs = messages.filter(m => m.role === 'tool');
    if (toolMsgs.length > turn1Results.length) {
      turn1Results.push(providerMessageText(toolMsgs.at(-1)?.content));
    }
    turn1Step++;
    if (turn1Step === 1) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: srcB, page: 1 } }] };
    if (turn1Step === 2) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: srcA, page: 1 } }] };
    if (turn1Step === 3) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: srcA, page: 99 } }] };
    if (turn1Step === 4) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: srcA } }] }; // omitted page -> single allowed page 4 only
    return { text: '第 4 页读取完毕。' };
  });

  const req1 = randomUUID();
  const offset1 = provider.requests.length;
  await api(`${base}/messages`, 'POST', {
    requestId: req1,
    expectedRevision: d0.discussion.revision,
    text: '只读第 4 页',
    importSourceIds: [srcA],
    selectedImportPages: { [srcA]: [4] },
  }, 202);
  const done1 = await waitForRun(api, base, req1);
  assert.equal(done1.discussion.lastRun.status, 'completed');

  assert.equal(turn1Results.length, 4);
  assert.match(turn1Results[0]!, /strategy_map_import_not_authorized/, 'other source in same discussion must be 403');
  assert.match(turn1Results[1]!, /strategy_map_import_page_not_authorized/, 'unselected page 1 must be 403');
  assert.match(turn1Results[2]!, /strategy_map_import_page_invalid/, 'out-of-range page 99 must be 400');
  assert.match(turn1Results[3]!, /首购后 60–90 天分层培育/, 'omitted page with single allowed page [4] reads page 4');
  // Unselected pages 1..3 text must NEVER reach the model provider
  const allTurn1Text = provider.requests.slice(offset1).map(r => JSON.stringify(r.body.messages)).join('\n');
  assert.equal(allTurn1Text.includes('封面'), false, 'page 1 content must never leak');
  assert.equal(allTurn1Text.includes('客群现状'), false, 'page 2 content must never leak');
  assert.equal(allTurn1Text.includes('复盘摘要'), false, 'page 3 content must never leak');

  // Turn 2: multi-page [2, 4] -> omitted page returns directoryOnly without full-file text dump
  const turn2Results: string[] = [];
  let turn2Step = 0;
  provider.setResponder(({ messages }) => {
    const toolMsgs = messages.filter(m => m.role === 'tool');
    const last = toolMsgs.at(-1);
    if (turn2Step > 0 && last) turn2Results.push(providerMessageText(last.content));
    turn2Step++;
    if (turn2Step === 1) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: srcA } }] };
    if (turn2Step === 2) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: srcA, page: 2 } }] };
    if (turn2Step === 3) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: srcA, page: 3 } }] };
    return { text: '多页目录与第 2 页核对完毕。' };
  });

  const req2 = randomUUID();
  await api(`${base}/messages`, 'POST', {
    requestId: req2,
    expectedRevision: done1.discussion.revision,
    text: '先看目录再看第 2 页',
    importSourceIds: [srcA],
    selectedImportPages: { [srcA]: [2, 4] },
  }, 202);
  const done2 = await waitForRun(api, base, req2);
  assert.equal(done2.discussion.lastRun.status, 'completed');

  const dirPayload = JSON.parse(turn2Results[0]!);
  assert.equal(dirPayload.directoryOnly, true, 'omitted page on multi-page must return directoryOnly');
  assert.deepEqual(dirPayload.source.allowedPages, [2, 4]);
  assert.equal(dirPayload.pages.every((p: Record<string, unknown>) => p.text === undefined && p.shapes === undefined && p.connectors === undefined), true, 'directoryOnly must NOT include page text/shapes/connectors');
  assert.equal(turn2Results[0]!.includes('门店企微 1v1 触达'), false, 'directoryOnly must NOT dump full page body');
  assert.match(turn2Results[1]!, /客群现状/, 'selected page 2 readable');
  assert.match(turn2Results[2]!, /strategy_map_import_page_not_authorized/, 'unselected page 3 blocked');
});

test('Item 2: revocation blocks follow-up chat even without saved map, enforces provenance consistency, and unifies project exclusions', { timeout: 60_000 }, async t => {
  const host = await startTestHost();
  const provider = await startToolProvider();
  t.after(async () => { await host.close(); await provider.close(); });
  const api = async (route: string, method = 'GET', body?: unknown, status = 200) => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, `${method} ${route}: ${await r.clone().text()}`);
    return r.json();
  };

  const { configuration } = await api('/api/configuration', 'PUT', {
    name: '撤权与溯源校验模型',
    provider: 'openai-compatible',
    baseUrl: provider.baseUrl,
    model: 'synthetic',
    apiKey: 'synthetic-only',
  });
  const { project } = await api('/api/projects', 'POST', { name: '排除边界测试项目', configurationId: configuration.id }, 201);
  const pptxBytes = await makeMemberOpsPptx();
  const up1 = (await api(`/api/projects/${project.id}/files/upload`, 'POST', { directory: '020_clean', name: '待排除文件1.pptx', content: pptxBytes.toString('base64') }, 201)).file;
  const up2 = (await api(`/api/projects/${project.id}/files/upload`, 'POST', { directory: '020_clean', name: '待排除文件2.pptx', content: pptxBytes.toString('base64') }, 201)).file;

  const { discussion } = await api('/api/strategy/discussions', 'POST', {
    operationId: randomUUID(),
    title: '撤权与排除一致性测试',
    projectId: project.id,
  }, 201);
  const base = `/api/strategy/discussions/${discussion.id}`;

  // Register project file up2 BEFORE excluding, and also upload a standalone PPTX
  const regUp2 = await api(`${base}/map-imports`, 'POST', { kind: 'project-file', uploadId: up2.id });
  const up2SrcId = regUp2.source.sourceId as string;

  // Exclude BOTH up1 (via project-document) and up2 (via strategy-attachment) in discussion sourceScope.excludedSources
  const ex1 = {
    id: `project-doc-${up1.id}`,
    title: up1.originalName,
    target: { kind: 'project-document', projectId: project.id, uploadId: up1.id, path: up1.path },
    sha256: up1.sha256,
    version: 1,
  };
  const ex2 = {
    id: `project-att-${up2.id}`,
    title: up2.originalName,
    target: { kind: 'strategy-attachment', projectId: project.id, fileId: up2.id, uploadId: up2.id, path: up2.path },
    sha256: up2.sha256,
    version: 1,
  };

  const patched = (await api(base, 'PATCH', {
    expectedRevision: discussion.revision,
    sourceScope: { mode: 'project-background', excludedSources: [ex1, ex2] },
  })).discussion;

  // Unified exclusion: neither listed in GET /map-imports, register blocked, previously registered preview/download blocked
  const libAfterExclude = await api(`${base}/map-imports`);
  assert.equal(libAfterExclude.reusable.some((r: { uploadId?: string }) => r.uploadId === up1.id || r.uploadId === up2.id), false);
  await api(`${base}/map-imports`, 'POST', { kind: 'project-file', uploadId: up1.id }, 403);
  await api(`${base}/map-imports/${up2SrcId}/preview?page=1`, 'GET', undefined, 403);
  await api(`${base}/map-imports/${up2SrcId}/download`, 'GET', undefined, 403);

  // Part B: Provenance consistency on user HTTP POST /maps
  const regStandalone = await api(`${base}/map-imports`, 'POST', {
    kind: 'upload',
    fileName: '独立原稿.pptx',
    bytes: pptxBytes.toString('base64'),
  });
  const srcId = regStandalone.source.sourceId as string;
  const validImportSrc = {
    sourceId: srcId,
    format: 'pptx',
    fileName: '独立原稿.pptx',
    sha256: regStandalone.source.sha256,
    origin: 'upload',
    selectedPages: [4],
  };

  // Forged sourceLocation.sourceId not in importSources -> 400
  await api(`${base}/maps`, 'POST', {
    mapId: randomUUID(), operationId: randomUUID(), expectedVersion: 0, reason: '伪造来源',
    draft: {
      title: '伪造测试', template: 'table',
      nodes: [{ id: 'G1', kind: 'goal', title: '目标', sourceLocation: { sourceId: 'forged-id', page: 1, label: '伪造' } }],
      edges: [], importSources: [validImportSrc],
    },
  }, 400);

  // Mismatched sourceLocation.page outside selectedPages [4] -> 400
  await api(`${base}/maps`, 'POST', {
    mapId: randomUUID(), operationId: randomUUID(), expectedVersion: 0, reason: '越界页码',
    draft: {
      title: '越界测试', template: 'table',
      nodes: [{ id: 'G1', kind: 'goal', title: '目标', sourceLocation: { sourceId: srcId, page: 1, label: '第1页' } }],
      edges: [], importSources: [validImportSrc],
    },
  }, 400);

  // Tampered sha256 in importSources -> 409 strategy_map_import_source_changed
  await api(`${base}/maps`, 'POST', {
    mapId: randomUUID(), operationId: randomUUID(), expectedVersion: 0, reason: '篡改哈希',
    draft: {
      title: '哈希测试', template: 'table',
      nodes: [{ id: 'G1', kind: 'goal', title: '目标' }],
      edges: [], importSources: [{ ...validImportSrc, sha256: '0'.repeat(64) }],
    },
  }, 409);

  // Out-of-bounds bbox (> 1000) -> 400
  await api(`${base}/maps`, 'POST', {
    mapId: randomUUID(), operationId: randomUUID(), expectedVersion: 0, reason: '越界框',
    draft: {
      title: '框测试', template: 'table',
      nodes: [{ id: 'G1', kind: 'goal', title: '目标', sourceLocation: { sourceId: srcId, page: 4, bbox: [900, 900, 200, 200], label: '越界框' } }],
      edges: [], importSources: [validImportSrc],
    },
  }, 400);

  // Part A: Agent reads import source WITHOUT saving any map -> revoke -> ordinary follow-up chat blocked with 0 Provider calls
  provider.setResponder(({ recentToolResults }) => {
    if (!recentToolResults.length) {
      return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: srcId, page: 4 } }] };
    }
    return { text: '已阅读第 4 页，暂未保存地图版本。' };
  });
  const reqReadOnly = randomUUID();
  await api(`${base}/messages`, 'POST', {
    requestId: reqReadOnly,
    expectedRevision: patched.revision,
    text: '先读第 4 页给我口头摘要，不要存地图',
    importSourceIds: [srcId],
    selectedImportPages: { [srcId]: [4] },
  }, 202);
  const doneReadOnly = await waitForRun(api, base, reqReadOnly);
  assert.equal(doneReadOnly.discussion.lastRun.status, 'completed');
  assert.equal((await api(`${base}/maps`)).versions.length, 0, 'confirm zero maps were saved');

  // Revoke srcId
  await api(`${base}/map-imports/${srcId}/revoke`, 'POST', {});

  // Ordinary follow-up chat (no importSourceIds!) MUST be blocked before dispatch with 0 new Provider requests
  const reqCountBefore = provider.requests.length;
  const followUpRes = await host.request(`${base}/messages`, 'POST', {
    requestId: randomUUID(),
    expectedRevision: doneReadOnly.discussion.revision,
    text: '继续聊一下刚才第 4 页的内容',
  });
  assert.equal(followUpRes.status, 403, `Expected 403 on revoked-history follow-up, got ${followUpRes.status}: ${await followUpRes.text()}`);
  assert.equal(provider.requests.length, reqCountBefore, 'Provider MUST receive 0 new requests after import revocation');
  // Native history remains intact
  const detailAfterRevoke = await api(base);
  assert.ok(detailAfterRevoke.snapshot.messages.length >= 2, 'native history preserved after revocation');
});

test('Item 3: truthful image delivery and real 7.6+ MiB PNG reaches synthetic vision Provider via official Pi SDK 1.4.0', { timeout: 90_000 }, async t => {
  const host = await startTestHost();
  const provider = await startToolProvider();
  t.after(async () => { await host.close(); await provider.close(); });
  const api = async (route: string, method = 'GET', body?: unknown, status = 200) => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, `${method} ${route}: ${await r.clone().text()}`);
    return r.json();
  };

  // Configure synthetic vision model (openai / gpt-4o routed to local loopback provider) + text-only model
  const visionConfig = (await api('/api/configuration', 'PUT', {
    name: '合成视觉模型',
    provider: 'openai',
    api: 'openai-completions',
    baseUrl: provider.baseUrl,
    model: 'gpt-4o',
    apiKey: 'synthetic-only',
  })).configuration;
  const textConfig = (await api('/api/configuration', 'PUT', {
    name: '合成纯文本模型',
    provider: 'openai-compatible',
    baseUrl: provider.baseUrl,
    model: 'synthetic',
    apiKey: 'synthetic-only',
  })).configuration;
  await api('/api/configuration/select', 'POST', { id: visionConfig.id });

  const { discussion } = await api('/api/strategy/discussions', 'POST', {
    operationId: randomUUID(),
    title: '大图视觉送达实测',
    configurationId: visionConfig.id,
  }, 201);
  const base = `/api/strategy/discussions/${discussion.id}`;

  const lib = await api(`${base}/map-imports`);
  assert.equal(lib.vision.supportsImages, true, 'openai/gpt-4o must be recognized as vision-capable');

  // Upload a real valid ~7.78 MiB (> 7,954,884 bytes) PNG — the exact size class that previously failed silently
  const bigPng = makeLargeValidPng(1700, 1600);
  assert.ok(bigPng.length >= 7_954_884 && bigPng.length <= 16 * 1024 * 1024, `expected ~7.8 MiB PNG, got ${bigPng.length}`);
  const regBigPng = await api(`${base}/map-imports`, 'POST', {
    kind: 'upload',
    fileName: '超清战略大图.png',
    bytes: bigPng.toString('base64'),
  });
  const bigPngId = regBigPng.source.sourceId as string;

  // Also upload a valid JPEG and a 2-sheet XLSX (Sheet 1 text-only, Sheet 2 has image)
  const regJpg = await api(`${base}/map-imports`, 'POST', {
    kind: 'upload',
    fileName: '白板拍照.jpg',
    bytes: TINY_JPEG.toString('base64'),
  });
  const jpgId = regJpg.source.sourceId as string;

  const regXlsx = await api(`${base}/map-imports`, 'POST', {
    kind: 'upload',
    fileName: '双表核对.xlsx',
    bytes: (await makeTwoSheetXlsxWithSheet2Image()).toString('base64'),
  });
  const xlsxId = regXlsx.source.sourceId as string;

  // Turn 1: Read ~7.8 MiB PNG -> tool receipt reports delivered: true AND Provider actually receives >= 1 image_url!
  let bigPngDelivery: any;
  let bigPngProviderImages = 0;
  let step = 0;
  provider.setResponder(({ messages }) => {
    step++;
    if (step === 1) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: bigPngId, page: 1 } }] };
    const toolMsg = messages.filter(m => m.role === 'tool').at(-1);
    bigPngDelivery = parseToolJson(toolMsg?.content).imageDelivery;
    bigPngProviderImages = collectProviderImageUrls(messages).length;
    return { text: '已真实收到大图图像块。' };
  });

  const d0 = await api(base);
  const req1 = randomUUID();
  await api(`${base}/messages`, 'POST', {
    requestId: req1,
    expectedRevision: d0.discussion.revision,
    text: '查看超清战略大图',
    importSourceIds: [bigPngId],
    selectedImportPages: { [bigPngId]: [1] },
  }, 202);
  const done1 = await waitForRun(api, base, req1);
  assert.deepEqual(provider.errors, [], 'synthetic provider should have zero errors');
  assert.equal(done1.discussion.lastRun.status, 'completed');
  assert.equal(bigPngDelivery?.delivered, true, `Expected delivered: true for ~7.8 MiB PNG, got ${JSON.stringify(bigPngDelivery)}`);
  assert.equal(bigPngDelivery?.count, 1);
  assert.ok(bigPngProviderImages >= 1, `Provider MUST actually receive >= 1 image_url for ~7.8 MiB PNG, got ${bigPngProviderImages}`);

  // Turn 2: Read JPEG + 2-sheet XLSX (page 1 has NO image, page 2 HAS image)
  const receipts: { tag: string; delivery: any; deltaImages: number }[] = [];
  let prevImgCount = bigPngProviderImages;
  let step2 = 0;
  provider.setResponder(({ messages }) => {
    const curImgs = collectProviderImageUrls(messages).length;
    const toolMsgs = messages.filter(m => m.role === 'tool');
    if (step2 === 1) receipts.push({ tag: 'jpg', delivery: parseToolJson(toolMsgs.at(-1)?.content).imageDelivery, deltaImages: curImgs - prevImgCount });
    if (step2 === 2) receipts.push({ tag: 'xlsx-p1', delivery: parseToolJson(toolMsgs.at(-1)?.content).imageDelivery, deltaImages: curImgs - prevImgCount });
    if (step2 === 3) receipts.push({ tag: 'xlsx-p2', delivery: parseToolJson(toolMsgs.at(-1)?.content).imageDelivery, deltaImages: curImgs - prevImgCount });
    prevImgCount = curImgs;
    step2++;
    if (step2 === 1) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: jpgId, page: 1 } }] };
    if (step2 === 2) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: xlsxId, page: 1 } }] };
    if (step2 === 3) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: xlsxId, page: 2 } }] };
    return { text: '全部读取核对完毕。' };
  });

  const req2 = randomUUID();
  await api(`${base}/messages`, 'POST', {
    requestId: req2,
    expectedRevision: done1.discussion.revision,
    text: '依次读取 JPEG、Excel 第 1 表和第 2 表',
    importSourceIds: [jpgId, xlsxId],
    selectedImportPages: { [jpgId]: [1], [xlsxId]: [1, 2] },
  }, 202);
  const done2 = await waitForRun(api, base, req2);
  assert.deepEqual(provider.errors, []);
  assert.equal(done2.discussion.lastRun.status, 'completed');

  const rJpg = receipts.find(r => r.tag === 'jpg')!;
  const rXlsx1 = receipts.find(r => r.tag === 'xlsx-p1')!;
  const rXlsx2 = receipts.find(r => r.tag === 'xlsx-p2')!;
  assert.equal(rJpg.delivery.delivered, true);
  assert.ok(rJpg.deltaImages >= 1, 'JPEG must deliver real image_url to Provider');
  assert.equal(rXlsx1.delivery.delivered, false, 'Excel Sheet 1 has NO image and must report delivered: false');
  assert.equal(rXlsx1.deltaImages, 0, 'Excel Sheet 1 must deliver 0 images to Provider');
  assert.equal(rXlsx2.delivery.delivered, true, 'Excel Sheet 2 has image and must report delivered: true');
  assert.ok(rXlsx2.deltaImages >= 1, 'Excel Sheet 2 must deliver real image_url to Provider');

  // Turn 3: Switch to text-only model on a fresh discussion and read same ~7.8 MiB PNG -> truthful delivered: false & 0 images at Provider
  const { discussion: textDisc } = await api('/api/strategy/discussions', 'POST', {
    operationId: randomUUID(),
    title: '纯文本降级回执核对',
    configurationId: textConfig.id,
  }, 201);
  const textBase = `/api/strategy/discussions/${textDisc.id}`;
  const regTextPng = await api(`${textBase}/map-imports`, 'POST', {
    kind: 'upload',
    fileName: '超清战略大图.png',
    bytes: bigPng.toString('base64'),
  });
  let textDelivery: any;
  let textImages = -1;
  let step3 = 0;
  provider.setResponder(({ messages }) => {
    step3++;
    if (step3 === 1) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: regTextPng.source.sourceId, page: 1 } }] };
    textDelivery = parseToolJson(messages.filter(m => m.role === 'tool').at(-1)?.content).imageDelivery;
    textImages = collectProviderImageUrls(messages).length;
    return { text: '纯文本模型收到如实未送图回执。' };
  });
  const req3 = randomUUID();
  await api(`${textBase}/messages`, 'POST', {
    requestId: req3,
    expectedRevision: textDisc.revision,
    text: '尝试读取图片',
    importSourceIds: [regTextPng.source.sourceId],
    selectedImportPages: { [regTextPng.source.sourceId]: [1] },
  }, 202);
  const done3 = await waitForRun(api, textBase, req3);
  assert.equal(done3.discussion.lastRun.status, 'completed');
  assert.equal(textDelivery?.delivered, false);
  assert.equal(textDelivery?.reason, 'text-only-model');
  assert.equal(textImages, 0, 'text-only model must receive 0 images');
});

test('Items 6A/6B & 7C: review-draft leaves 0 versions until one-click save, workingMapDraft reaches reread, and zero-node scanned draft succeeds', { timeout: 60_000 }, async t => {
  const host = await startTestHost();
  const provider = await startToolProvider();
  t.after(async () => { await host.close(); await provider.close(); });
  const api = async (route: string, method = 'GET', body?: unknown, status = 200) => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, `${method} ${route}: ${await r.clone().text()}`);
    return r.json();
  };

  await api('/api/configuration', 'PUT', {
    name: '草稿核对测试模型',
    provider: 'openai-compatible',
    baseUrl: provider.baseUrl,
    model: 'synthetic',
    apiKey: 'synthetic-only',
  });
  const { discussion } = await api('/api/strategy/discussions', 'POST', { operationId: randomUUID(), title: '草稿核对与空节点扫描' }, 201);
  const base = `/api/strategy/discussions/${discussion.id}`;

  const regPptx = await api(`${base}/map-imports`, 'POST', {
    kind: 'upload',
    fileName: '战略草稿.pptx',
    bytes: (await makeMemberOpsPptx()).toString('base64'),
  });
  const srcId = regPptx.source.sourceId as string;

  const baseDraft = {
    title: '会员复购战略候选',
    template: 'table' as const,
    choice: '聚焦新客二购',
    nodes: [
      { id: 'G1', kind: 'goal' as const, title: '新客 90 天复购率', baseline: '9%', target: '18%', unit: '%', reviewState: 'clear' as const, sourceLocation: { sourceId: srcId, page: 4, label: '第 4 页 G1' } },
      { id: 'S1', kind: 'strategy' as const, title: '首购分层培育', reviewState: 'clear' as const, sourceLocation: { sourceId: srcId, page: 4, label: '第 4 页 S1' } },
    ],
    edges: [
      { id: 'E1', from: 'S1', to: 'G1', kind: 'unknown' as const, reviewState: 'needs-review' as const, ambiguityReason: '箭头被遮挡', sourceLocation: { sourceId: srcId, page: 4, label: '第 4 页 E1' } },
    ],
    importSources: [{ sourceId: srcId, format: 'pptx' as const, fileName: '战略草稿.pptx', sha256: regPptx.source.sha256, origin: 'upload' as const, selectedPages: [4] }],
  };

  // Turn 1: importMode = 'review-draft': save-map rejected (409), propose-map-draft succeeds, /maps stays at 0 versions!
  let saveMapBlockedErr = '';
  let step1 = 0;
  provider.setResponder(({ messages }) => {
    const toolMsgs = messages.filter(m => m.role === 'tool');
    if (step1 === 2) saveMapBlockedErr = providerMessageText(toolMsgs.at(-1)?.content);
    step1++;
    if (step1 === 1) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: srcId, page: 4 } }] };
    if (step1 === 2) return { calls: [{ name: 'strategy_goals', arguments: { action: 'save-map', mapDraft: baseDraft, reason: '越权提前落盘' } }] };
    if (step1 === 3) return { calls: [{ name: 'strategy_goals', arguments: { action: 'propose-map-draft', mapDraft: baseDraft, reason: '提取待核草稿' } }] };
    return { text: '已生成待核草稿，等待你对照原稿确认后保存。' };
  });

  const req1 = randomUUID();
  await api(`${base}/messages`, 'POST', {
    requestId: req1,
    expectedRevision: discussion.revision,
    text: '请提取待核草稿',
    importSourceIds: [srcId],
    selectedImportPages: { [srcId]: [4] },
    importMode: 'review-draft',
  }, 202);
  const done1 = await waitForRun(api, base, req1);
  assert.equal(done1.discussion.lastRun.status, 'completed');
  assert.match(saveMapBlockedErr, /strategy_map_import_draft_required/, 'save-map MUST be blocked during review-draft mode');
  assert.equal((await api(`${base}/maps`)).versions.length, 0, 'ZERO map versions may be written before user clicks Save');
  assert.equal(done1.mapImportDrafts?.length, 1);
  assert.equal(done1.mapImportDrafts[0].draft.nodes[0].baseline, '9%');

  // Turn 2: Local reread carries user's edited workingMapDraft (15%) into Provider prompt, returns draft2, still 0 saved versions!
  const editedWorkingDraft = {
    ...baseDraft,
    nodes: baseDraft.nodes.map(n => (n.id === 'G1' ? { ...n, baseline: '15%', reviewState: 'confirmed' as const } : n)),
  };
  let step2 = 0;
  provider.setResponder(() => {
    step2++;
    if (step2 === 1) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: srcId, page: 4 } }] };
    if (step2 === 2) {
      return {
        calls: [{
          name: 'strategy_goals',
          arguments: {
            action: 'propose-map-draft',
            reason: '局部重读 E1',
            mapDraft: { ...editedWorkingDraft, edges: [{ ...baseDraft.edges[0]!, kind: 'supports', reviewState: 'clear', ambiguityReason: '' }] },
          },
        }],
      };
    }
    return { text: '已局部重读 E1，保留你的 15% 手工修改。' };
  });

  const req2 = randomUUID();
  const offset2 = provider.requests.length;
  await api(`${base}/messages`, 'POST', {
    requestId: req2,
    expectedRevision: done1.discussion.revision,
    text: '局部重读 E1 连线',
    importSourceIds: [srcId],
    selectedImportPages: { [srcId]: [4] },
    importMode: 'review-draft',
    workingMapDraft: editedWorkingDraft,
  }, 202);
  const done2 = await waitForRun(api, base, req2);
  assert.equal(done2.discussion.lastRun.status, 'completed');
  const rereadPrompt = providerMessageText(provider.requests[offset2]!.body.messages?.filter(m => m.role === 'user').at(-1)?.content);
  assert.match(rereadPrompt, /"baseline":"15%"/, 'workingMapDraft containing user manual edit 15% MUST reach Provider');
  assert.equal((await api(`${base}/maps`)).versions.length, 0, 'still 0 saved versions after reread before Save');
  assert.equal(done2.mapImportDrafts?.length, 2);

  // User clicks Save ONCE with importDraftEntryId -> creates v1 (author: 'user') preserving provenance & 15% edit
  const draft2 = done2.mapImportDrafts[1];
  const savedV1 = (await api(`${base}/maps`, 'POST', {
    mapId: randomUUID(),
    operationId: randomUUID(),
    expectedVersion: 0,
    reason: '用户核对确认后一次保存',
    importDraftEntryId: draft2.entryId,
    draft: draft2.draft,
  }, 201)).version as StrategyMapVersion;
  assert.equal(savedV1.version, 1);
  assert.equal(savedV1.author, 'user');
  assert.equal(savedV1.nodes.find(n => n.id === 'G1')?.baseline, '15%');
  assert.equal(savedV1.edges.find(e => e.id === 'E1')?.kind, 'supports');
  assert.equal(savedV1.source?.version, draft2.source?.version);

  // Item 7C: Zero-node scanned image draft succeeds via propose-map-draft AND user save
  const regScan = await api(`${base}/map-imports`, 'POST', { kind: 'upload', fileName: '扫描白板.png', bytes: TINY_PNG.toString('base64') });
  const scanId = regScan.source.sourceId as string;
  const zeroNodeDraft = {
    title: '扫描白板待核草稿',
    template: 'table' as const,
    choice: '',
    unknowns: '当前纯文本模型无法识别扫描白板内容，请切换已配置视觉模型或对照左侧原稿手工补录条目。',
    nodes: [],
    edges: [],
    importSources: [{ sourceId: scanId, format: 'image' as const, fileName: '扫描白板.png', sha256: regScan.source.sha256, origin: 'upload' as const, selectedPages: [1] }],
  };
  let step3 = 0;
  provider.setResponder(() => {
    step3++;
    if (step3 === 1) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: scanId, page: 1 } }] };
    if (step3 === 2) return { calls: [{ name: 'strategy_goals', arguments: { action: 'propose-map-draft', mapDraft: zeroNodeDraft, reason: '纯文本扫描图无法提取节点，返回待核空草稿' } }] };
    return { text: '纯文本模型无法看清扫描白板，已返回待核空草稿供你手工补录或切换视觉模型。' };
  });
  const dBeforeScan = await api(base);
  const req3 = randomUUID();
  await api(`${base}/messages`, 'POST', {
    requestId: req3,
    expectedRevision: dBeforeScan.discussion.revision,
    text: '尝试提取扫描白板',
    importSourceIds: [scanId],
    selectedImportPages: { [scanId]: [1] },
    importMode: 'review-draft',
  }, 202);
  const done3 = await waitForRun(api, base, req3);
  assert.equal(done3.discussion.lastRun.status, 'completed');
  const zeroReceipt = done3.mapImportDrafts?.at(-1);
  assert.ok(zeroReceipt, 'zero-node scanned draft must be accepted by propose-map-draft');
  assert.equal(zeroReceipt.draft.nodes.length, 0);
  const savedZero = (await api(`${base}/maps`, 'POST', {
    mapId: randomUUID(),
    operationId: randomUUID(),
    expectedVersion: 0,
    reason: '保存扫描待核空草稿',
    importDraftEntryId: zeroReceipt.entryId,
    draft: zeroReceipt.draft,
  }, 201)).version as StrategyMapVersion;
  assert.equal(savedZero.nodes.length, 0);
  assert.match(savedZero.unknowns, /纯文本模型无法识别/);
});
