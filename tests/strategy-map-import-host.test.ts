import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

test('Issue 115 import draft page faults keep stable codes and safe details before a corrected draft receipt', { timeout: 60_000 }, async t => {
  const host = await startTestHost(), provider = await startToolProvider();
  t.after(async () => { await host.close(); await provider.close(); });
  const api = async (route: string, method = 'GET', body?: unknown, status = 200) => {
    const response = await host.request(route, method, body);
    assert.equal(response.status, status, await response.clone().text());
    return response.json();
  };
  await api('/api/configuration', 'PUT', { name: '页码错误合成模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic', apiKey: 'synthetic-only' });
  const { discussion } = await api('/api/strategy/discussions', 'POST', { operationId: randomUUID(), title: '页码错误契约' }, 201);
  const base = `/api/strategy/discussions/${discussion.id}`;
  const reg = await api(`${base}/map-imports`, 'POST', { kind: 'upload', fileName: '四页战略材料.pptx', bytes: (await makeMemberOpsPptx()).toString('base64') });
  const sourceId = reg.source.sourceId as string;
  const importSource = { sourceId, format: 'pptx', fileName: '四页战略材料.pptx', sha256: reg.source.sha256, origin: 'upload' };
  const receipts: string[] = [];
  provider.setResponder(({ recentToolResults }) => {
    if (recentToolResults.length > receipts.length) receipts.push(providerMessageText(recentToolResults.at(-1)?.content));
    if (recentToolResults.length < 3) {
      const page = [2, 99, 1][recentToolResults.length]!;
      return { calls: [{ name: 'strategy_goals', arguments: { action: 'propose-map-draft', reason: `页码 ${page} 合成校验`, mapDraft: {
        title: `页码 ${page} 草稿`, template: 'bsc', choice: '', assumptions: '', unknowns: '',
        nodes: [{ id: 'G1', kind: 'goal', title: '复购', sourceLocation: { sourceId, page, label: `第 ${page} 页` } }], edges: [], importSources: [importSource],
      } } }] };
    }
    return { text: '页码错误已修正并生成待核草稿。' };
  });
  const before = await api(base), requestId = randomUUID();
  await api(`${base}/messages`, 'POST', { requestId, expectedRevision: before.discussion.revision, text: '先核对越界页，再修正到第 1 页', importSourceIds: [sourceId], selectedImportPages: { [sourceId]: [1] }, importMode: 'review-draft' }, 202);
  const done = await waitForRun(api, base, requestId);
  assert.equal(done.discussion.lastRun.status, 'completed');
  assert.equal(receipts.length, 3);
  assert.match(receipts[0]!, /invalid_strategy_map/);
  assert.match(receipts[0]!, /page_outside_selection/);
  assert.match(receipts[1]!, /strategy_map_import_page_invalid/);
  assert.match(receipts[1]!, /page_outside_original/);
  assert.match(receipts[2]!, /editable-map-import-draft/);
  assert.ok(!receipts.some(receipt => receipt.includes('personal_context_read_failed')));
  assert.ok(!receipts.some(receipt => receipt.includes('四页战略材料.pptx') && receipt.includes('page_outside_')), 'page fault details must not echo the file name');
  assert.equal(done.mapImportDrafts.length, 1);
  assert.equal((await api(`${base}/maps`)).versions.length, 0, 'draft generation and failed validation do not write formal map versions');
});

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

test('Round-2 Items 1 & 2: selectedPages omitted by Agent is backfilled by Host, and workingMapDraft-only history is blocked after revocation', { timeout: 60_000 }, async t => {
  const host = await startTestHost();
  const provider = await startToolProvider();
  t.after(async () => { await host.close(); await provider.close(); });
  const api = async (route: string, method = 'GET', body?: unknown, status = 200) => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, `${method} ${route}: ${await r.clone().text()}`);
    return r.json();
  };

  await api('/api/configuration', 'PUT', {
    name: '选页回填与草稿撤权模型',
    provider: 'openai-compatible',
    baseUrl: provider.baseUrl,
    model: 'synthetic',
    apiKey: 'synthetic-only',
  });
  const { discussion } = await api('/api/strategy/discussions', 'POST', { operationId: randomUUID(), title: '选页回填与草稿撤权' }, 201);
  const base = `/api/strategy/discussions/${discussion.id}`;

  const regA = await api(`${base}/map-imports`, 'POST', {
    kind: 'upload',
    fileName: '四页汇报.pptx',
    bytes: (await makeMemberOpsPptx()).toString('base64'),
  });
  const srcA = regA.source.sourceId as string;

  // Part 1A: Agent calls propose-map-draft OMITTING draft.importSources[0].selectedPages during a turn scoped to page [4]
  let turn1Step = 0;
  provider.setResponder(() => {
    turn1Step++;
    if (turn1Step === 1) {
      return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: srcA, page: 4 } }] };
    }
    if (turn1Step === 2) {
      return {
        calls: [{
          name: 'strategy_goals',
          arguments: {
            action: 'propose-map-draft',
            reason: '省略 selectedPages 的待核草稿',
            mapDraft: {
              title: '第 4 页策略方案',
              template: 'bsc',
              choice: '聚焦第 4 页策略',
              nodes: [{ id: 'G1', kind: 'goal', title: '新客二购率', baseline: '9%', target: '18%', sourceLocation: { sourceId: srcA, page: 4, label: '第4页' } }],
              edges: [],
              importSources: [{ sourceId: srcA, format: 'pptx', fileName: '四页汇报.pptx', sha256: regA.source.sha256, origin: 'upload' }],
            },
          },
        }],
      };
    }
    return { text: '已生成草稿。' };
  });

  const d0 = await api(base);
  const req1 = randomUUID();
  await api(`${base}/messages`, 'POST', {
    requestId: req1,
    expectedRevision: d0.discussion.revision,
    text: '仅提取第 4 页',
    importSourceIds: [srcA],
    selectedImportPages: { [srcA]: [4] },
    importMode: 'review-draft',
  }, 202);
  const done1 = await waitForRun(api, base, req1);
  assert.equal(done1.discussion.lastRun.status, 'completed');
  const draft1 = done1.mapImportDrafts?.[0];
  assert.ok(draft1, 'expected pending draft');
  assert.deepEqual(draft1.draft.importSources[0].selectedPages, [4], 'Host MUST backfill selectedPages=[4] into draft receipt');

  // Subsequent reread omitting selectedImportPages MUST still stay scoped to [4] (page 1 -> 403)
  let rereadToolErr = '';
  let turn2Step = 0;
  provider.setResponder(({ messages }) => {
    const lastTool = messages.filter(m => m.role === 'tool').at(-1);
    if (turn2Step === 1 && lastTool) rereadToolErr = providerMessageText(lastTool.content);
    turn2Step++;
    if (turn2Step === 1) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: srcA, page: 1 } }] };
    if (turn2Step === 2) {
      return {
        calls: [{
          name: 'strategy_goals',
          arguments: {
            action: 'propose-map-draft',
            reason: '重读修订草稿',
            mapDraft: {
              ...draft1.draft,
              importSources: [{ sourceId: srcA, format: 'pptx', fileName: '四页汇报.pptx', sha256: regA.source.sha256, origin: 'upload' }],
            },
          },
        }],
      };
    }
    return { text: '重读完成。' };
  });
  const req2 = randomUUID();
  await api(`${base}/messages`, 'POST', {
    requestId: req2,
    expectedRevision: done1.discussion.revision,
    text: '重读本草稿',
    importSourceIds: [srcA],
    importMode: 'review-draft',
    supersedesDraftEntryId: draft1.entryId,
    workingMapDraft: { ...draft1.draft, importSources: [{ sourceId: srcA, format: 'pptx', fileName: '四页汇报.pptx', sha256: regA.source.sha256, origin: 'upload' }] },
  }, 202);
  const done2 = await waitForRun(api, base, req2);
  assert.equal(done2.discussion.lastRun.status, 'completed');
  assert.match(rereadToolErr, /strategy_map_import_page_not_authorized/, 'omitting selectedImportPages on reread MUST NOT widen to page 1');
  assert.equal(done2.mapImportDrafts.length, 1, 'reread with supersedesDraftEntryId replaces latest in same draftGroup');
  assert.deepEqual(done2.mapImportDrafts[0].draft.importSources[0].selectedPages, [4]);

  // Saving even with selectedPages omitted in payload MUST persist selectedPages=[4]
  const savedV1 = (await api(`${base}/maps`, 'POST', {
    mapId: randomUUID(),
    operationId: randomUUID(),
    expectedVersion: 0,
    reason: '核对后保存',
    importDraftEntryId: done2.mapImportDrafts[0].entryId,
    draft: { ...done2.mapImportDrafts[0].draft, importSources: [{ sourceId: srcA, format: 'pptx', fileName: '四页汇报.pptx', sha256: regA.source.sha256, origin: 'upload' }] },
  }, 201)).version as StrategyMapVersion;
  assert.deepEqual(savedV1.importSources?.[0]?.selectedPages, [4], 'saved version MUST preserve Host-known selectedPages=[4]');

  // Part 1B: Second discussion where a source enters native history ONLY via workingMapDraft (ZERO read-import-source calls)
  const { discussion: discB } = await api('/api/strategy/discussions', 'POST', { operationId: randomUUID(), title: '纯 workingMapDraft 撤权拦截' }, 201);
  const baseB = `/api/strategy/discussions/${discB.id}`;
  const regOnlyDraft = await api(`${baseB}/map-imports`, 'POST', {
    kind: 'upload',
    fileName: '仅草稿引用.png',
    bytes: TINY_PNG.toString('base64'),
  });
  const srcOnly = regOnlyDraft.source.sourceId as string;

  provider.setResponder(() => ({ text: '已阅读用户传入的 workingMapDraft，未调用任何 read-import-source 工具。' }));
  const dB0 = await api(baseB);
  const reqB1 = randomUUID();
  await api(`${baseB}/messages`, 'POST', {
    requestId: reqB1,
    expectedRevision: dB0.discussion.revision,
    text: '请评审我传入的草稿',
    workingMapDraft: {
      title: '纯草稿引用方案',
      template: 'table',
      choice: '测试草稿',
      nodes: [{ id: 'G1', kind: 'goal', title: '目标1', sourceLocation: { sourceId: srcOnly, page: 1, label: '图1' } }],
      edges: [],
      importSources: [{ sourceId: srcOnly, format: 'image', fileName: '仅草稿引用.png', sha256: regOnlyDraft.source.sha256, origin: 'upload', selectedPages: [1] }],
    },
  }, 202);
  const doneB1 = await waitForRun(api, baseB, reqB1);
  assert.equal(doneB1.discussion.lastRun.status, 'completed');

  // Revoke srcOnly -> ordinary follow-up chat MUST be blocked BEFORE dispatch (0 new Provider requests)
  await api(`${baseB}/map-imports/${srcOnly}/revoke`, 'POST', {});
  const countBefore = provider.requests.length;
  const reqB2 = randomUUID();
  const followUpRes = await host.request(`${baseB}/messages`, 'POST', {
    requestId: reqB2,
    expectedRevision: doneB1.discussion.revision,
    text: '继续普通追问（不附带任何导入参数）',
  });
  assert.equal(followUpRes.status, 403, `expected 403 after workingMapDraft source revocation, got ${followUpRes.status}: ${await followUpRes.clone().text()}`);
  assert.match(await followUpRes.text(), /strategy_map_import_revoked/);
  assert.equal(provider.requests.length, countBefore, 'blocked follow-up MUST make 0 new Provider requests');
});

test('Round-2 Items 2, 4 & 5: standalone draft reread does not bind older saved map; multi-plan drafts survive save/dismiss; dual-tab single-save lock and persistent dismissal across restart', { timeout: 60_000 }, async t => {
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), 'optracall-r2-persist-'));
  const provider = await startToolProvider();
  let host = await startTestHost({ dataRoot });
  t.after(async () => {
    await host.close();
    await provider.close();
    rmSync(dataRoot, { recursive: true, force: true });
  });
  const api = async (route: string, method = 'GET', body?: unknown, status = 200) => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, `${method} ${route}: ${await r.clone().text()}`);
    return r.json();
  };

  await api('/api/configuration', 'PUT', {
    name: '多方案与并发锁模型',
    provider: 'openai-compatible',
    baseUrl: provider.baseUrl,
    model: 'synthetic',
    apiKey: 'synthetic-only',
  });
  const { discussion } = await api('/api/strategy/discussions', 'POST', { operationId: randomUUID(), title: '多方案与双标签锁' }, 201);
  const base = `/api/strategy/discussions/${discussion.id}`;

  // Seed an older unrelated saved map v1 in this discussion
  const oldMapId = randomUUID();
  const oldMap = (await api(`${base}/maps`, 'POST', {
    mapId: oldMapId,
    operationId: randomUUID(),
    expectedVersion: 0,
    reason: '历史已保存方案',
    draft: {
      title: '旧版门店扩张地图',
      template: 'bsc',
      choice: '旧版选择',
      nodes: [{ id: 'G0', kind: 'goal', title: '旧目标' }],
      edges: [],
    },
  }, 201)).version as StrategyMapVersion;
  assert.equal(oldMap.version, 1);

  const reg = await api(`${base}/map-imports`, 'POST', {
    kind: 'upload',
    fileName: '双方案原稿.pptx',
    bytes: (await makeMemberOpsPptx()).toString('base64'),
  });
  const srcId = reg.source.sourceId as string;
  const importSrc = { sourceId: srcId, format: 'pptx' as const, fileName: '双方案原稿.pptx', sha256: reg.source.sha256, origin: 'upload' as const, selectedPages: [4] };

  // Turn 1: Agent proposes TWO standalone plans (Plan A & Plan B) in ONE turn
  let t1 = 0;
  provider.setResponder(() => {
    t1++;
    if (t1 === 1) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: srcId, page: 4 } }] };
    if (t1 === 2) {
      return {
        calls: [
          {
            name: 'strategy_goals',
            arguments: {
              action: 'propose-map-draft',
              reason: '方案 A 待核草稿',
              mapDraft: {
                title: '方案 A · 会员留存',
                template: 'bsc',
                choice: '聚焦老客留存',
                nodes: [{ id: 'GA1', kind: 'goal', title: '老客复购率', baseline: '18%', target: '26%', sourceLocation: { sourceId: srcId, page: 4, label: '第4页' } }],
                edges: [],
                importSources: [importSrc],
              },
            },
          },
          {
            name: 'strategy_goals',
            arguments: {
              action: 'propose-map-draft',
              reason: '方案 B 待核草稿',
              mapDraft: {
                title: '方案 B · 新客培育',
                template: 'bsc',
                choice: '聚焦新客二购',
                nodes: [{ id: 'GB1', kind: 'goal', title: '新客二购率', baseline: '9%', target: '18%', sourceLocation: { sourceId: srcId, page: 4, label: '第4页' } }],
                edges: [],
                importSources: [importSrc],
              },
            },
          },
        ],
      };
    }
    return { text: '已提取方案 A 与方案 B 两份待核草稿。' };
  });

  const d0 = await api(base);
  const req1 = randomUUID();
  await api(`${base}/messages`, 'POST', {
    requestId: req1,
    expectedRevision: d0.discussion.revision,
    text: '请分别整理方案 A 和方案 B 两份待核草稿',
    importSourceIds: [srcId],
    selectedImportPages: { [srcId]: [4] },
    importMode: 'review-draft',
  }, 202);
  const done1 = await waitForRun(api, base, req1);
  assert.equal(done1.discussion.lastRun.status, 'completed');
  assert.equal(done1.mapImportDrafts?.length, 2, 'BOTH Plan A and Plan B MUST remain accessible');
  const planA = done1.mapImportDrafts.find((d: any) => d.draft.title.includes('方案 A'));
  const planB = done1.mapImportDrafts.find((d: any) => d.draft.title.includes('方案 B'));
  assert.ok(planA && planB);
  assert.notEqual(planA.draftGroupId, planB.draftGroupId);

  // Reread standalone Plan B (without mapRef): Provider prompt MUST NOT attach oldMapId / 旧版门店扩张地图
  let t2 = 0;
  provider.setResponder(() => {
    t2++;
    if (t2 === 1) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: srcId, page: 4 } }] };
    if (t2 === 2) {
      return {
        calls: [{
          name: 'strategy_goals',
          arguments: {
            action: 'propose-map-draft',
            reason: '方案 B 局部重读修订',
            mapDraft: {
              ...planB.draft,
              title: '方案 B · 新客培育（修订）',
              template: 'tree',
              nodes: [{ ...planB.draft.nodes[0], baseline: '15%' }],
            },
          },
        }],
      };
    }
    return { text: '方案 B 局部重读完毕。' };
  });
  const offset2 = provider.requests.length;
  const req2 = randomUUID();
  await api(`${base}/messages`, 'POST', {
    requestId: req2,
    expectedRevision: done1.discussion.revision,
    text: '局部重读方案 B',
    importSourceIds: [srcId],
    selectedImportPages: { [srcId]: [4] },
    importMode: 'review-draft',
    supersedesDraftEntryId: planB.entryId,
    workingMapDraft: { ...planB.draft, title: '方案 B · 新客培育（修订）', template: 'tree', nodes: [{ ...planB.draft.nodes[0], baseline: '15%' }] },
  }, 202);
  const done2 = await waitForRun(api, base, req2);
  assert.equal(done2.discussion.lastRun.status, 'completed');
  const rereadPromptText = providerMessageText(provider.requests[offset2]!.body.messages?.filter(m => m.role === 'user').at(-1)?.content);
  assert.equal(rereadPromptText.includes(oldMapId), false, 'standalone draft reread MUST NOT attach unrelated older saved mapId');
  assert.equal(rereadPromptText.includes('旧版门店扩张地图'), false, 'standalone draft reread MUST NOT inject unrelated older map body');
  assert.equal(done2.mapImportDrafts.length, 2, 'Plan A and updated Plan B MUST both remain active');
  const planB2 = done2.mapImportDrafts.find((d: any) => d.draftGroupId === planB.draftGroupId);
  assert.ok(planB2 && planB2.entryId !== planB.entryId);

  // Dual-tab concurrent/sequential save on Plan B: Tab 1 succeeds 201 (new mapId !== oldMapId), Tab 2 fails 409 strategy_map_import_draft_already_saved
  const tab1MapId = randomUUID();
  const tab1OpId = randomUUID();
  const tab2MapId = randomUUID();
  const tab2OpId = randomUUID();
  const [res1, res2] = await Promise.all([
    host.request(`${base}/maps`, 'POST', {
      mapId: tab1MapId, operationId: tab1OpId, expectedVersion: 0, reason: '标签页1保存方案B',
      importDraftEntryId: planB2.entryId, draft: planB2.draft,
    }),
    host.request(`${base}/maps`, 'POST', {
      mapId: tab2MapId, operationId: tab2OpId, expectedVersion: 0, reason: '标签页2重复保存方案B',
      importDraftEntryId: planB2.entryId, draft: planB2.draft,
    }),
  ]);
  const statuses = [res1.status, res2.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [201, 409], 'dual-tab save MUST return one 201 and one 409 conflict');
  const conflictRes = res1.status === 409 ? res1 : res2;
  const winnerRes = res1.status === 201 ? res1 : res2;
  const winnerOpId = res1.status === 201 ? tab1OpId : tab2OpId;
  const winnerMapId = res1.status === 201 ? tab1MapId : tab2MapId;
  assert.match(await conflictRes.text(), /strategy_map_import_draft_already_saved/);
  const winnerVer = (await winnerRes.json()).version as StrategyMapVersion;
  assert.equal(winnerVer.version, 1);
  assert.notEqual(winnerVer.mapId, oldMapId, 'standalone Plan B MUST create a new mapId, leaving oldMapId at v1');

  // Exact same operationId retry remains idempotent
  const replay = await api(`${base}/maps`, 'POST', {
    mapId: winnerMapId, operationId: winnerOpId, expectedVersion: 0,
    reason: res1.status === 201 ? '标签页1保存方案B' : '标签页2重复保存方案B',
    importDraftEntryId: planB2.entryId, draft: planB2.draft,
  }, 201);
  assert.equal(replay.version.mapId, winnerMapId);
  assert.equal(replay.version.version, 1);

  // Also verify older superseded entryId of Plan B cannot be saved either
  await api(`${base}/maps`, 'POST', {
    mapId: randomUUID(), operationId: randomUUID(), expectedVersion: 0, reason: '旧入口重存',
    importDraftEntryId: planB.entryId, draft: planB.draft,
  }, 409);

  // Plan A MUST still be active after Plan B is saved!
  const afterSaveB = await api(base);
  assert.equal(afterSaveB.mapImportDrafts?.length, 1, 'Plan A MUST remain active after Plan B is saved');
  assert.equal(afterSaveB.mapImportDrafts[0].draftGroupId, planA.draftGroupId);

  // Dismiss Plan A via Host persistent endpoint -> disappears immediately, blocks save with 409, AND stays dismissed after Host restart!
  await api(`${base}/map-drafts/${encodeURIComponent(planA.entryId)}/dismiss`, 'POST', {});
  const afterDismissA = await api(base);
  assert.equal(afterDismissA.mapImportDrafts, undefined, 'no active pending drafts after Plan A dismissed');
  await api(`${base}/maps`, 'POST', {
    mapId: randomUUID(), operationId: randomUUID(), expectedVersion: 0, reason: '尝试保存已放弃草稿',
    importDraftEntryId: planA.entryId, draft: planA.draft,
  }, 409);

  // Restart Host on the same dataRoot -> dismissed Plan A MUST NOT reappear, and catalog has ONLY oldMap v1 + Plan B v1 (2 versions total)
  await host.close();
  host = await startTestHost({ dataRoot });
  const afterRestart = await api(base);
  assert.equal(afterRestart.mapImportDrafts, undefined, 'dismissed draft MUST NOT reopen after Host restart');
  const catalogAfterRestart = await api(`${base}/maps`);
  assert.equal(catalogAfterRestart.versions.length, 2, 'exactly 2 saved maps (oldMap v1 + Plan B v1)');
  assert.equal(catalogAfterRestart.versions.filter((v: StrategyMapVersion) => v.mapId === oldMapId).length, 1);

  // Explicit revision of oldMapId WITH mapRef DOES attach oldMapId and creates v2
  let t3 = 0;
  provider.setResponder(() => {
    t3++;
    if (t3 === 1) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: srcId, page: 4 } }] };
    if (t3 === 2) {
      return {
        calls: [{
          name: 'strategy_goals',
          arguments: {
            action: 'propose-map-draft',
            mapId: oldMapId,
            expectedVersion: 1,
            reason: '基于旧地图 v1 修订',
            mapDraft: {
              title: '旧版门店扩张地图（修订）',
              template: 'bsc',
              choice: '修订选择',
              nodes: [{ id: 'G0', kind: 'goal', title: '旧目标更新' }],
              edges: [],
              importSources: [importSrc],
            },
          },
        }],
      };
    }
    return { text: '已生成旧版地图的 v2 修订草稿。' };
  });
  const offset3 = provider.requests.length;
  const req3 = randomUUID();
  await api(`${base}/messages`, 'POST', {
    requestId: req3,
    expectedRevision: afterRestart.discussion.revision,
    text: '对照原稿修订旧版门店扩张地图 v1',
    importSourceIds: [srcId],
    selectedImportPages: { [srcId]: [4] },
    importMode: 'review-draft',
    mapRef: { mapId: oldMapId, version: 1 },
  }, 202);
  const done3 = await waitForRun(api, base, req3);
  assert.equal(done3.discussion.lastRun.status, 'completed');
  const revPromptText = providerMessageText(provider.requests[offset3]!.body.messages?.filter(m => m.role === 'user').at(-1)?.content);
  assert.equal(revPromptText.includes(oldMapId), true, 'explicit mapRef revision MUST attach oldMapId');
  const revDraft = done3.mapImportDrafts?.[0];
  assert.equal(revDraft?.mapId, oldMapId);
  assert.equal(revDraft?.expectedVersion, 1);
  const savedV2 = (await api(`${base}/maps`, 'POST', {
    mapId: oldMapId, operationId: randomUUID(), expectedVersion: 1, reason: '保存旧地图修订 v2',
    importDraftEntryId: revDraft.entryId, draft: revDraft.draft,
  }, 201)).version as StrategyMapVersion;
  assert.equal(savedV2.mapId, oldMapId);
  assert.equal(savedV2.version, 2);
});

test('Round-3 Items 1, 2 & 5: per-source selectedPages upper bound rejects widening with 0 writes; Host binds B v1 even when Agent omits mapId; stale entry returns 409 superseded; crash-before-disposition recovers without duplicate v1', { timeout: 90_000 }, async t => {
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), 'optracall-r3-host-'));
  const provider = await startToolProvider();
  let host = await startTestHost({ dataRoot });
  t.after(async () => {
    await host.close();
    await provider.close();
    rmSync(dataRoot, { recursive: true, force: true });
  });
  const api = async (route: string, method = 'GET', body?: unknown, status = 200) => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, `${method} ${route}: ${await r.clone().text()}`);
    return r.json();
  };

  await api('/api/configuration', 'PUT', {
    name: '三轮主机门禁验证模型',
    provider: 'openai-compatible',
    baseUrl: provider.baseUrl,
    model: 'synthetic',
    apiKey: 'synthetic-only',
  });
  const { discussion } = await api('/api/strategy/discussions', 'POST', { operationId: randomUUID(), title: '三轮选页与恢复验证' }, 201);
  const base = `/api/strategy/discussions/${discussion.id}`;

  const reg = await api(`${base}/map-imports`, 'POST', {
    kind: 'upload',
    fileName: '四页战略材料.pptx',
    bytes: (await makeMemberOpsPptx()).toString('base64'),
  });
  const srcId = reg.source.sourceId as string;
  const baseImportSrc = { sourceId: srcId, format: 'pptx' as const, fileName: '四页战略材料.pptx', sha256: reg.source.sha256, origin: 'upload' as const };

  // Turn 1: Initial extract scoped to pages [2, 4] -> produces entryB1 (unknown, 9%)
  let t1 = 0;
  provider.setResponder(() => {
    t1++;
    if (t1 === 1) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: srcId, page: 4 } }] };
    if (t1 === 2) {
      return {
        calls: [{
          name: 'strategy_goals',
          arguments: {
            action: 'propose-map-draft',
            reason: '首轮待核草稿 B1',
            mapDraft: {
              title: '方案 B · 初始草稿',
              template: 'bsc',
              choice: '初版',
              nodes: [
                { id: 'G1', kind: 'goal', title: '新客二购率', baseline: '9%', target: '18%', sourceLocation: { sourceId: srcId, page: 2, label: '第2页' } },
                { id: 'S1', kind: 'strategy', title: '分层培育', sourceLocation: { sourceId: srcId, page: 4, label: '第4页' } },
              ],
              edges: [{ id: 'e1', from: 'G1', to: 'S1', kind: 'unknown', reviewState: 'needs-review', sourceLocation: { sourceId: srcId, page: 4, label: '第4页' } }],
              importSources: [{ ...baseImportSrc, selectedPages: [2, 4] }],
            },
          },
        }],
      };
    }
    return { text: '首轮草稿已生成。' };
  });
  const d0 = await api(base);
  const req1 = randomUUID();
  await api(`${base}/messages`, 'POST', {
    requestId: req1,
    expectedRevision: d0.discussion.revision,
    text: '提取第 2、4 页',
    importSourceIds: [srcId],
    selectedImportPages: { [srcId]: [2, 4] },
    importMode: 'review-draft',
  }, 202);
  const done1 = await waitForRun(api, base, req1);
  assert.equal(done1.discussion.lastRun.status, 'completed');
  const entryB1 = done1.mapImportDrafts[0];
  assert.deepEqual(entryB1.draft.importSources[0].selectedPages, [2, 4]);

  // Item 1 NEGATIVE: Widening selectedImportPages [1, 2, 4] on reread of entryB1 -> 403 with 0 Provider calls & 0 writes!
  const provCountBeforeWiden = provider.requests.length;
  const revBeforeWiden = done1.discussion.revision;
  await api(`${base}/messages`, 'POST', {
    requestId: randomUUID(),
    expectedRevision: revBeforeWiden,
    text: '试图扩大到第 1 页',
    importSourceIds: [srcId],
    selectedImportPages: { [srcId]: [1, 2, 4] },
    importMode: 'review-draft',
    supersedesDraftEntryId: entryB1.entryId,
    workingMapDraft: entryB1.draft,
  }, 403);
  // Item 1 NEGATIVE: Widening workingMapDraft.importSources[0].selectedPages to [1, 2, 4] -> 403!
  await api(`${base}/messages`, 'POST', {
    requestId: randomUUID(),
    expectedRevision: revBeforeWiden,
    text: '工作草稿试图扩大到第 1 页',
    importSourceIds: [srcId],
    selectedImportPages: { [srcId]: [4] },
    importMode: 'review-draft',
    supersedesDraftEntryId: entryB1.entryId,
    workingMapDraft: { ...entryB1.draft, importSources: [{ ...baseImportSrc, selectedPages: [1, 2, 4] }] },
  }, 403);
  // Item 1 NEGATIVE: Widening POST /maps save payload selectedPages to [1, 2, 4] -> 403 with 0 saved versions!
  await api(`${base}/maps`, 'POST', {
    mapId: randomUUID(),
    operationId: randomUUID(),
    expectedVersion: 0,
    reason: '试图扩大选页保存',
    importDraftEntryId: entryB1.entryId,
    draft: { ...entryB1.draft, importSources: [{ ...baseImportSrc, selectedPages: [1, 2, 4] }] },
  }, 403);
  assert.equal(provider.requests.length, provCountBeforeWiden, 'widening attempts MUST make 0 Provider calls');
  assert.equal((await api(`${base}/maps`)).versions.length, 0, 'widening save MUST write 0 map versions');

  // Item 1 POSITIVE (shrinking): Reread entryB1 shrinking selectedImportPages to [4] ONLY -> ALLOWED; page 2 read blocked 403, page 4 succeeds -> produces entryB2 (supports, 15%)
  let shrinkPage2Err = '';
  let t2 = 0;
  provider.setResponder(({ messages }) => {
    const lastTool = messages.filter(m => m.role === 'tool').at(-1);
    if (t2 === 1 && lastTool) shrinkPage2Err = providerMessageText(lastTool.content);
    t2++;
    if (t2 === 1) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: srcId, page: 2 } }] };
    if (t2 === 2) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: srcId, page: 4 } }] };
    if (t2 === 3) {
      return {
        calls: [{
          name: 'strategy_goals',
          arguments: {
            action: 'propose-map-draft',
            reason: '缩小至第 4 页重读后草稿 B2',
            mapDraft: {
              ...entryB1.draft,
              nodes: [
                { ...entryB1.draft.nodes[0], baseline: '15%' },
                entryB1.draft.nodes[1],
              ],
              edges: [{ ...entryB1.draft.edges[0], from: 'S1', to: 'G1', kind: 'supports', reviewState: 'clear' }],
            },
          },
        }],
      };
    }
    return { text: '已仅重读第 4 页并更新连线 e1。' };
  });
  const req2 = randomUUID();
  await api(`${base}/messages`, 'POST', {
    requestId: req2,
    expectedRevision: revBeforeWiden,
    text: '只重读第 4 页连线',
    importSourceIds: [srcId],
    selectedImportPages: { [srcId]: [4] },
    importMode: 'review-draft',
    supersedesDraftEntryId: entryB1.entryId,
    workingMapDraft: { ...entryB1.draft, nodes: [{ ...entryB1.draft.nodes[0], baseline: '15%' }, entryB1.draft.nodes[1]] },
  }, 202);
  const done2 = await waitForRun(api, base, req2);
  assert.equal(done2.discussion.lastRun.status, 'completed');
  assert.match(shrinkPage2Err, /strategy_map_import_page_not_authorized/, 'shrunk reread [4] MUST block reading page 2');
  assert.equal(done2.mapImportDrafts.length, 1);
  const entryB2 = done2.mapImportDrafts[0];
  assert.notEqual(entryB2.entryId, entryB1.entryId);
  assert.equal(entryB2.draftGroupId, entryB1.draftGroupId);

  // Item 5A (Stale tab): Saving or dismissing stale entryB1 AFTER entryB2 arrived -> 409 strategy_map_import_draft_superseded; 0 maps written; entryB2 stays active!
  const staleSaveRes = await host.request(`${base}/maps`, 'POST', {
    mapId: randomUUID(),
    operationId: randomUUID(),
    expectedVersion: 0,
    reason: '旧标签保存过期 B1',
    importDraftEntryId: entryB1.entryId,
    draft: entryB1.draft,
  });
  assert.equal(staleSaveRes.status, 409);
  assert.match(await staleSaveRes.text(), /strategy_map_import_draft_superseded/);
  const staleDismissRes = await host.request(`${base}/map-drafts/${encodeURIComponent(entryB1.entryId)}/dismiss`, 'POST', {});
  assert.equal(staleDismissRes.status, 409);
  assert.match(await staleDismissRes.text(), /strategy_map_import_draft_superseded/);
  assert.equal((await api(`${base}/maps`)).versions.length, 0, 'stale tab save MUST NOT write unknown/9% to disk');
  assert.equal((await api(base)).mapImportDrafts.length, 1, 'entryB2 MUST stay pending after stale tab 409');

  // Save latest entryB2 -> writes mapB v1 (with importDraftGroupId & importDraftEntryId atomically persisted on the map version!)
  const mapBId = randomUUID();
  const mapBOpId = randomUUID();
  const mapBV1 = (await api(`${base}/maps`, 'POST', {
    mapId: mapBId,
    operationId: mapBOpId,
    expectedVersion: 0,
    reason: '确认最新 B2',
    importDraftEntryId: entryB2.entryId,
    draft: entryB2.draft,
  }, 201)).version as StrategyMapVersion;
  assert.equal(mapBV1.version, 1);
  assert.equal(mapBV1.importDraftGroupId, entryB2.draftGroupId);
  assert.equal(mapBV1.importDraftEntryId, entryB2.entryId);

  // Item 5B (Crash-before-disposition recovery): Delete map-import-draft-dispositions.json and restart Host on same dataRoot!
  const dispFile = path.join(dataRoot, 'strategy-discussions', discussion.id, 'map-import-draft-dispositions.json');
  rmSync(dispFile, { force: true });
  await host.close();
  host = await startTestHost({ dataRoot });

  // After restart: draft MUST NOT reopen as pending, a new-tab save with different mapId/operationId MUST fail 409, and exact operationId retry is idempotent!
  const afterCrashRestart = await api(base);
  assert.equal(afterCrashRestart.mapImportDrafts, undefined, 'saved draft MUST NOT reappear even if disposition file was lost before crash');
  const dupAfterCrash = await host.request(`${base}/maps`, 'POST', {
    mapId: randomUUID(),
    operationId: randomUUID(),
    expectedVersion: 0,
    reason: '重启后新标签误再保存',
    importDraftEntryId: entryB2.entryId,
    draft: entryB2.draft,
  });
  assert.equal(dupAfterCrash.status, 409);
  assert.match(await dupAfterCrash.text(), /strategy_map_import_draft_already_saved/);
  const idempotentRetry = await api(`${base}/maps`, 'POST', {
    mapId: mapBId,
    operationId: mapBOpId,
    expectedVersion: 0,
    reason: '确认最新 B2',
    importDraftEntryId: entryB2.entryId,
    draft: entryB2.draft,
  }, 201);
  assert.equal(idempotentRetry.version.mapId, mapBId);
  assert.equal(idempotentRetry.version.version, 1);
  assert.equal((await api(`${base}/maps`)).versions.length, 1, 'exactly ONE v1 exists after crash recovery + retry + new-tab conflict');

  // Item 2 (Saved map revision where Agent OMITS mapId/expectedVersion): Host MUST bind mapBId v1 and Save MUST produce mapB v2!
  let t3 = 0;
  provider.setResponder(() => {
    t3++;
    if (t3 === 1) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-import-source', importSourceId: srcId, page: 4 } }] };
    if (t3 === 2) {
      return {
        calls: [{
          name: 'strategy_goals',
          arguments: {
            action: 'propose-map-draft',
            // Intentionally OMIT mapId and expectedVersion!
            reason: '修订 B v1 但 Agent 省略 mapId',
            mapDraft: {
              ...entryB2.draft,
              title: 'Agent返回的旧标题',
              edges: [{ ...entryB2.draft.edges[0], kind: 'hypothesis', reviewState: 'confirmed' }],
            },
          },
        }],
      };
    }
    return { text: '已局部重读 B v1。' };
  });
  const req3 = randomUUID();
  await api(`${base}/messages`, 'POST', {
    requestId: req3,
    expectedRevision: afterCrashRestart.discussion.revision,
    text: '基于 B v1 重读第 4 页 e1',
    importSourceIds: [srcId],
    selectedImportPages: { [srcId]: [4] },
    importMode: 'review-draft',
    mapRef: { mapId: mapBId, version: 1 },
    workingMapDraft: { ...entryB2.draft, title: 'B v1 人工新标题' },
  }, 202);
  const done3 = await waitForRun(api, base, req3);
  assert.equal(done3.discussion.lastRun.status, 'completed');
  const revDraftOmitted = done3.mapImportDrafts?.[0];
  assert.equal(revDraftOmitted?.mapId, mapBId, 'Host MUST bind mapBId even when Agent omits optional mapId');
  assert.equal(revDraftOmitted?.expectedVersion, 1, 'Host MUST bind expectedVersion=1 even when Agent omits it');

  // Trying to save this bound revision draft under a DIFFERENT mapId MUST be rejected 409!
  await api(`${base}/maps`, 'POST', {
    mapId: randomUUID(),
    operationId: randomUUID(),
    expectedVersion: 0,
    reason: '错误另建 v1',
    importDraftEntryId: revDraftOmitted.entryId,
    draft: revDraftOmitted.draft,
  }, 409);

  // Saving under mapBId creates B v2 (NOT a second v1)!
  const mapBV2 = (await api(`${base}/maps`, 'POST', {
    mapId: mapBId,
    operationId: randomUUID(),
    expectedVersion: 1,
    reason: '保存 B v2 修订',
    importDraftEntryId: revDraftOmitted.entryId,
    draft: { ...revDraftOmitted.draft, title: 'B v1 人工新标题' },
  }, 201)).version as StrategyMapVersion;
  assert.equal(mapBV2.mapId, mapBId);
  assert.equal(mapBV2.version, 2);
  assert.equal(mapBV2.title, 'B v1 人工新标题');
  // Item 1 NEGATIVE against fixed saved map B v2: widening selectedImportPages to [1, 4] on revision of B v2 -> 403!
  const dAfterV2 = await api(base);
  await api(`${base}/messages`, 'POST', {
    requestId: randomUUID(),
    expectedRevision: dAfterV2.discussion.revision,
    text: '试图修订 B v2 时扩大到第 1 页',
    importSourceIds: [srcId],
    selectedImportPages: { [srcId]: [1, 4] },
    importMode: 'review-draft',
    mapRef: { mapId: mapBId, version: 2 },
  }, 403);
});
