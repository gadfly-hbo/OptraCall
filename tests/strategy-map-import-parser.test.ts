import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import {
  decodeStrategyMapImportFile,
  detectImportFormat,
  inspectImageMetadata,
} from '../src/host/strategy-map-import.ts';
import { StrategyMapImportStore } from '../src/host/strategy-map-import-store.ts';

// Minimal 1x1 PNG (width=1, height=1)
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63f8cfc000000301010018dd8db00000000049454e44ae426082',
  'hex',
);

// Minimal valid JPEG with APP1 EXIF Orientation=6 (90° CW) and SOF0 320x240
function makeSyntheticJpeg(width = 320, height = 240, orientation = 6): Buffer {
  // APP1 EXIF header (big-endian MM) with 1 IFD0 entry: tag 0x0112 (Orientation), type SHORT(3), count 1, value=orientation
  const exif = Buffer.alloc(32);
  exif.write('Exif\0\0', 0, 'ascii');
  exif.write('MM', 6, 'ascii');
  exif.writeUInt16BE(42, 8);
  exif.writeUInt32BE(8, 10); // IFD0 offset
  exif.writeUInt16BE(1, 14); // 1 entry
  exif.writeUInt16BE(0x0112, 16); // Orientation tag
  exif.writeUInt16BE(3, 18); // SHORT
  exif.writeUInt32BE(1, 20); // count (bytes 20..23)
  exif.writeUInt16BE(orientation, 24); // value (bytes 24..25)
  exif.writeUInt16BE(0, 26); // padding (bytes 26..27)
  exif.writeUInt32BE(0, 28); // next IFD (bytes 28..31)
  const app1Len = Buffer.alloc(2);
  app1Len.writeUInt16BE(exif.length + 2, 0);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), app1Len, exif]);

  // SOF0 marker: precision=8, height, width, 3 components
  const sof0 = Buffer.alloc(19);
  sof0[0] = 0xff; sof0[1] = 0xc0;
  sof0.writeUInt16BE(17, 2);
  sof0[4] = 8;
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0[9] = 3;
  sof0[10] = 1; sof0[11] = 0x11; sof0[12] = 0;
  sof0[13] = 2; sof0[14] = 0x11; sof0[15] = 0;
  sof0[16] = 3; sof0[17] = 0x11; sof0[18] = 0;

  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof0, Buffer.from([0xff, 0xd9])]);
}

// Synthetic PPTX with non-lexicographic slide order (slide10, slide2, slide1, slide4) where slide #4 in presentation order is the member ops strategy map
async function makeSyntheticPptx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
  // Presentation lists 4 slides in order: rId1->slide10, rId2->slide2, rId3->slide1, rId4->slide4
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:sldIdLst>
        <p:sldId id="256" r:id="rId1"/>
        <p:sldId id="257" r:id="rId2"/>
        <p:sldId id="258" r:id="rId3"/>
        <p:sldId id="259" r:id="rId4"/>
      </p:sldIdLst>
      <p:sldSz cx="12192000" cy="6858000"/>
    </p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide10.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
      <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
      <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide4.xml"/>
    </Relationships>`);
  const simpleSlide = (title: string) => `<?xml version="1.0" encoding="UTF-8"?>
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="600000" y="400000"/><a:ext cx="8000000" cy="800000"/></a:xfrm></p:spPr>
          <p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody>
        </p:sp>
      </p:spTree></p:cSld>
    </p:sld>`;
  zip.file('ppt/slides/slide10.xml', simpleSlide('封面 · 2026 会员运营'));
  zip.file('ppt/slides/slide2.xml', simpleSlide('客群现状'));
  zip.file('ppt/slides/slide1.xml', simpleSlide('复盘摘要'));
  zip.file('ppt/slides/slide4.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:cNvPr id="10" name="策略框S1"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="900000" y="1800000"/><a:ext cx="3600000" cy="1400000"/></a:xfrm></p:spPr>
          <p:txBody><a:p><a:r><a:t>首购后 60–90 天分层培育</a:t></a:r></a:p></p:txBody>
        </p:sp>
        <p:sp><p:nvSpPr><p:cNvPr id="20" name="目标框G1"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="7200000" y="1800000"/><a:ext cx="3800000" cy="1400000"/></a:xfrm></p:spPr>
          <p:txBody><a:p><a:r><a:t>提高新客 90 天二购率</a:t></a:r></a:p><a:p><a:r><a:t>约 9%（年度目标待定）</a:t></a:r></a:p></p:txBody>
        </p:sp>
        <p:cxnSp>
          <p:nvCxnSpPr>
            <p:cNvPr id="30" name="连接符S1到G1"/>
            <p:cNvCxnSpPr><a:stCxn id="10" idx="1"/><a:endCxn id="20" idx="3"/></p:cNvCxnSpPr>
            <p:nvPr/>
          </p:nvCxnSpPr>
          <p:spPr><a:xfrm><a:off x="4500000" y="2400000"/><a:ext cx="2700000" cy="100000"/></a:xfrm>
            <a:ln><a:tailEnd type="triangle"/></a:ln>
          </p:spPr>
        </p:cxnSp>
      </p:spTree></p:cSld>
    </p:sld>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

// Synthetic mixed XLSX: structured sheet + drawing shape with conflicting value + embedded PNG
async function makeSyntheticMixedXlsx(): Promise<Buffer> {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['目标编号', '目标项', '指标', '基线', '目标值', '单位'],
    ['G1', '提升直营渠道毛利率', '直营毛利率', '12.5%', '18%', '%'],
  ]), '目标表');
  const raw = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
  const zip = await JSZip.loadAsync(raw);
  zip.file('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <xdr:twoCellAnchor>
        <xdr:from><xdr:col>5</xdr:col><xdr:row>1</xdr:row></xdr:from>
        <xdr:to><xdr:col>9</xdr:col><xdr:row>5</xdr:row></xdr:to>
        <xdr:sp>
          <xdr:nvSpPr><xdr:cNvPr id="3" name="形状3"/><xdr:cNvSpPr/></xdr:nvSpPr>
          <xdr:txBody><a:p><a:r><a:t>提升直营渠道毛利率 · 目标 15%</a:t></a:r></a:p></xdr:txBody>
        </xdr:sp>
      </xdr:twoCellAnchor>
    </xdr:wsDr>`);
  zip.file('xl/media/image1.png', TINY_PNG);
  return zip.generateAsync({ type: 'nodebuffer' });
}

// Minimal valid PDF with a single page containing readable ASCII text
function makeSyntheticPdf(withText = true): Buffer {
  const streamContent = withText ? 'BT /F1 14 Tf 72 720 Td (Strategy Map Goal: 12 stores) Tj ET' : '';
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ${withText ? '/Resources << /Font << /F1 5 0 R >> >> ' : ''}/Contents 4 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Length ${Buffer.byteLength(streamContent)} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
    ...(withText ? ['5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'] : []),
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(out));
    out += obj;
  }
  const xrefPos = Buffer.byteLength(out);
  out += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  out += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(out, 'ascii');
}

test('detectImportFormat accepts xlsx, pptx, pdf, png, jpg, jpeg and rejects unsupported formats', () => {
  assert.equal(detectImportFormat('plan.xlsx'), 'xlsx');
  assert.equal(detectImportFormat('deck.PPTX'), 'pptx');
  assert.equal(detectImportFormat('scan.pdf'), 'pdf');
  assert.equal(detectImportFormat('board.png'), 'image');
  assert.equal(detectImportFormat('photo.jpg'), 'image');
  assert.equal(detectImportFormat('photo.JPEG'), 'image');
  assert.throws(() => detectImportFormat('notes.docx'), /strategy_map_import_format_unsupported/);
});

test('inspectImageMetadata preserves PNG/JPEG dimensions and EXIF orientation and rejects spoofed bytes', () => {
  const pngMeta = inspectImageMetadata('board.png', TINY_PNG);
  assert.deepEqual(pngMeta, { width: 1, height: 1, orientation: 1, mimeType: 'image/png' });

  const jpgMeta = inspectImageMetadata('photo.jpeg', makeSyntheticJpeg(320, 240, 6));
  assert.deepEqual(jpgMeta, { width: 320, height: 240, orientation: 6, mimeType: 'image/jpeg' });

  assert.throws(() => inspectImageMetadata('fake.png', Buffer.from('not a png')), /strategy_map_import_invalid_image/);
});

test('decodeStrategyMapImportFile parses PPTX in real presentation order with shapes and connector endpoints', async () => {
  const pptx = await makeSyntheticPptx();
  const parsed = await decodeStrategyMapImportFile('会员运营复盘_2026Q1.pptx', pptx);
  assert.equal(parsed.format, 'pptx');
  assert.equal(parsed.pages.length, 4);
  // Real presentation order: slide10 is page 1, slide4 is page 4
  assert.match(parsed.pages[0]!.title, /封面/);
  assert.equal(parsed.pages[3]!.page, 4);
  const p4 = parsed.pages[3]!;
  assert.ok(p4.shapes.some(s => s.text.includes('首购后 60–90 天分层培育')));
  assert.ok(p4.shapes.some(s => s.text.includes('提高新客 90 天二购率') && s.text.includes('约 9%')));
  assert.equal(p4.connectors.length, 1);
  assert.equal(p4.connectors[0]!.fromObjectId, '10');
  assert.equal(p4.connectors[0]!.toObjectId, '20');
  assert.equal(p4.connectors[0]!.arrowDirection, 'forward');
});

test('decodeStrategyMapImportFile parses mixed XLSX sheets, drawings, and embedded images together', async () => {
  const xlsx = await makeSyntheticMixedXlsx();
  const parsed = await decodeStrategyMapImportFile('渠道毛利战略图_混排.xlsx', xlsx);
  assert.equal(parsed.format, 'xlsx');
  assert.equal(parsed.workbook?.sheets[0]?.name, '目标表');
  assert.ok(parsed.pages.some(p => p.shapes.some(s => s.text.includes('15%'))));
  assert.equal(parsed.embeddedImages?.length, 1);
  assert.equal(parsed.embeddedImages?.[0]?.mimeType, 'image/png');
});

test('decodeStrategyMapImportFile parses PDF text pages and flags image-only/no-text pages', async () => {
  const textPdf = await decodeStrategyMapImportFile('text.pdf', makeSyntheticPdf(true));
  assert.equal(textPdf.format, 'pdf');
  assert.equal(textPdf.pages.length, 1);
  assert.equal(textPdf.pages[0]!.hasTextLayer, true);
  assert.match(textPdf.pages[0]!.text, /Strategy Map Goal: 12 stores/);

  const scanPdf = await decodeStrategyMapImportFile('scan.pdf', makeSyntheticPdf(false));
  assert.equal(scanPdf.format, 'pdf');
  assert.equal(scanPdf.pages.length, 1);
  assert.equal(scanPdf.pages[0]!.hasTextLayer, false);
  assert.equal(scanPdf.pages[0]!.needsVisualReview, true);
});

test('StrategyMapImportStore preserves immutable bytes, supports same-name replacement, and blocks reads after revocation', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'optracall-map-import-'));
  try {
    const store = new StrategyMapImportStore(root);
    const discussionId = '11111111-1111-4111-8111-111111111111';
    const v1Bytes = TINY_PNG;
    const v2Bytes = makeSyntheticJpeg(320, 240, 1);

    const { source: first } = await store.saveUpload(discussionId, '战略白板.png', v1Bytes);
    const { source: second } = await store.saveUpload(discussionId, '战略白板.jpg', v2Bytes);
    assert.notEqual(first.sourceId, second.sourceId);
    assert.equal((await store.readBytes(discussionId, first.sourceId)).equals(v1Bytes), true);

    // Same-name replacement with different bytes preserves v1 and yields a distinct sourceId
    const v2ReplacedBytes = makeSyntheticJpeg(640, 480, 1);
    const { source: secondV2 } = await store.saveUpload(discussionId, '战略白板.jpg', v2ReplacedBytes);
    assert.notEqual(secondV2.sourceId, second.sourceId);
    assert.equal((await store.readBytes(discussionId, second.sourceId)).equals(v2Bytes), true);
    assert.equal((await store.readBytes(discussionId, secondV2.sourceId)).equals(v2ReplacedBytes), true);

    await store.revoke(discussionId, first.sourceId);
    await assert.rejects(() => store.readBytes(discussionId, first.sourceId), /strategy_map_import_revoked/);
    // Second source remains readable
    assert.equal((await store.readBytes(discussionId, second.sourceId)).equals(v2Bytes), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
