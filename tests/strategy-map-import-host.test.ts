import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
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

