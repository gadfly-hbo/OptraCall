import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import {
  decodeStrategyMapImportFile,
  detectImportFormat,
  inspectImageMetadata,
  renderImportPageImage,
} from '../src/host/strategy-map-import.ts';
import { StrategyMapImportStore } from '../src/host/strategy-map-import-store.ts';

// Minimal 1x1 PNG (width=1, height=1)
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63f8cfc000000301010018dd8db00000000049454e44ae426082',
  'hex',
);

// Distinct solid PNG generator for verifying sheet-scoped multi-image extraction
function makeSolidPng(width: number, height: number, r: number, g: number, b: number): Buffer {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      raw[rowStart + 1 + x * 3] = r;
      raw[rowStart + 1 + x * 3 + 1] = g;
      raw[rowStart + 1 + x * 3 + 2] = b;
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Minimal valid JPEG with APP1 EXIF Orientation=6 (90° CW) and SOF0 320x240
function makeSyntheticJpeg(width = 320, height = 240, orientation = 6): Buffer {
  const exif = Buffer.alloc(32);
  exif.write('Exif\0\0', 0, 'ascii');
  exif.write('MM', 6, 'ascii');
  exif.writeUInt16BE(42, 8);
  exif.writeUInt32BE(8, 10);
  exif.writeUInt16BE(1, 14);
  exif.writeUInt16BE(0x0112, 16);
  exif.writeUInt16BE(3, 18);
  exif.writeUInt32BE(1, 20);
  exif.writeUInt16BE(orientation, 24);
  exif.writeUInt16BE(0, 26);
  exif.writeUInt32BE(0, 28);
  const app1Len = Buffer.alloc(2);
  app1Len.writeUInt16BE(exif.length + 2, 0);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), app1Len, exif]);

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

// Synthetic PPTX with non-lexicographic slide order + translated/scaled grpSp group shape
async function makeSyntheticPptx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:sldIdLst>
        <p:sldId id="256" r:id="rId1"/>
        <p:sldId id="257" r:id="rId2"/>
        <p:sldId id="258" r:id="rId3"/>
        <p:sldId id="259" r:id="rId4"/>
      </p:sldIdLst>
      <p:sldSz cx="12000000" cy="6750000"/>
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
  // Slide 4 includes normal shapes, connector, AND a translated & scaled group shape (<p:grpSp>)
  // Child raw coords (1200000, 900000, 2400000, 900000) would wrongly map to [100,133,200,133];
  // With group off=(5400000, 1800000), ext=(7200000, 2700000), chOff=(0,0), chExt=(4800000, 2700000) (sx=1.5, sy=1),
  // mapped slide coords are (7200000, 2700000, 3600000, 900000) -> normalized [600, 400, 300, 133]!
  zip.file('ppt/slides/slide4.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld><p:spTree>
        <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
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
        <p:grpSp>
          <p:nvGrpSpPr><p:cNvPr id="40" name="组合容器"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
          <p:grpSpPr>
            <a:xfrm>
              <a:off x="5400000" y="1800000"/><a:ext cx="7200000" cy="2700000"/>
              <a:chOff x="0" y="0"/><a:chExt cx="4800000" cy="2700000"/>
            </a:xfrm>
          </p:grpSpPr>
          <p:sp>
            <p:nvSpPr><p:cNvPr id="41" name="组合内子框"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
            <p:spPr><a:xfrm><a:off x="1200000" y="900000"/><a:ext cx="2400000" cy="900000"/></a:xfrm></p:spPr>
            <p:txBody><a:p><a:r><a:t>老客流失预警机制</a:t></a:r></a:p></p:txBody>
          </p:sp>
        </p:grpSp>
      </p:spTree></p:cSld>
    </p:sld>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

// Synthetic 2-sheet XLSX: Sheet 1 = pure cells ONLY; Sheet 2 = textbox + chart (title only in chart) + 2 distinct PNGs + SmartArt
async function makeTwoSheetMixedXlsx(imgA: Buffer, imgB: Buffer): Promise<Buffer> {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['目标编号', '目标项', '指标', '基线', '目标值', '单位'],
    ['G1', '提升直营渠道毛利率', '直营毛利率', '12.5%', '18%', '%'],
  ]), '目标表');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['说明'],
    ['第二页为混排战略图'],
  ]), '战略图示');
  const raw = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
  const zip = await JSZip.loadAsync(raw);

  // Link drawing1 ONLY to sheet2 (xl/worksheets/sheet2.xml)
  zip.file('xl/worksheets/_rels/sheet2.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
    </Relationships>`);
  zip.file('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
      <Relationship Id="rIdImg2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image2.png"/>
      <Relationship Id="rIdChart1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>
      <Relationship Id="rIdDiag1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData" Target="../diagrams/data1.xml"/>
    </Relationships>`);
  zip.file('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
              xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
              xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram">
      <xdr:twoCellAnchor>
        <xdr:from><xdr:col>1</xdr:col><xdr:row>1</xdr:row></xdr:from>
        <xdr:to><xdr:col>5</xdr:col><xdr:row>4</xdr:row></xdr:to>
        <xdr:sp>
          <xdr:nvSpPr><xdr:cNvPr id="3" name="第二表文本框"/><xdr:cNvSpPr/></xdr:nvSpPr>
          <xdr:txBody><a:p><a:r><a:t>提升直营渠道毛利率 · 图上写 15%</a:t></a:r></a:p></xdr:txBody>
        </xdr:sp>
      </xdr:twoCellAnchor>
      <xdr:twoCellAnchor>
        <xdr:from><xdr:col>6</xdr:col><xdr:row>1</xdr:row></xdr:from>
        <xdr:to><xdr:col>11</xdr:col><xdr:row>8</xdr:row></xdr:to>
        <xdr:graphicFrame>
          <xdr:nvGraphicFramePr><xdr:cNvPr id="4" name="图表1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
          <a:graphic><a:graphicData><c:chart r:id="rIdChart1"/></a:graphicData></a:graphic>
        </xdr:graphicFrame>
      </xdr:twoCellAnchor>
      <xdr:twoCellAnchor>
        <xdr:from><xdr:col>1</xdr:col><xdr:row>6</xdr:row></xdr:from>
        <xdr:to><xdr:col>5</xdr:col><xdr:row>12</xdr:row></xdr:to>
        <xdr:pic>
          <xdr:nvPicPr><xdr:cNvPr id="5" name="门店结构图A"/><xdr:cNvPicPr/></xdr:nvPicPr>
          <xdr:blipFill><a:blip r:embed="rIdImg1"/></xdr:blipFill>
        </xdr:pic>
      </xdr:twoCellAnchor>
      <xdr:twoCellAnchor>
        <xdr:from><xdr:col>6</xdr:col><xdr:row>10</xdr:row></xdr:from>
        <xdr:to><xdr:col>11</xdr:col><xdr:row>16</xdr:row></xdr:to>
        <xdr:pic>
          <xdr:nvPicPr><xdr:cNvPr id="6" name="会员漏斗图B"/><xdr:cNvPicPr/></xdr:nvPicPr>
          <xdr:blipFill><a:blip r:embed="rIdImg2"/></xdr:blipFill>
        </xdr:pic>
      </xdr:twoCellAnchor>
      <xdr:twoCellAnchor>
        <xdr:from><xdr:col>1</xdr:col><xdr:row>14</xdr:row></xdr:from>
        <xdr:to><xdr:col>5</xdr:col><xdr:row>18</xdr:row></xdr:to>
        <xdr:graphicFrame>
          <xdr:nvGraphicFramePr><xdr:cNvPr id="7" name="SmartArt1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
          <a:graphic><a:graphicData><dgm:relIds r:dm="rIdDiag1"/></a:graphicData></a:graphic>
        </xdr:graphicFrame>
      </xdr:twoCellAnchor>
    </xdr:wsDr>`);
  zip.file('xl/charts/chart1.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <c:chart>
        <c:title><c:tx><c:rich><a:p><a:r><a:t>华东渠道净利率独有图表标题</a:t></a:r></a:p></c:rich></c:tx></c:title>
        <c:plotArea>
          <c:barChart><c:ser><c:tx><c:v>直营店毛利</c:v></c:tx></c:ser></c:barChart>
        </c:plotArea>
      </c:chart>
    </c:chartSpace>`);
  zip.file('xl/diagrams/data1.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <dgm:ptLst><dgm:pt modelId="sm-1"><dgm:t><a:p><a:r><a:t>SmartArt 供应链协同节点</a:t></a:r></a:p></dgm:t></dgm:pt></dgm:ptLst>
    </dgm:dataModel>`);
  zip.file('xl/media/image1.png', imgA);
  zip.file('xl/media/image2.png', imgB);
  return zip.generateAsync({ type: 'nodebuffer' });
}

// Standalone chart-only XLSX where the only content is a chart title
async function makeChartOnlyXlsx(): Promise<Buffer> {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), '图表页');
  const raw = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
  const zip = await JSZip.loadAsync(raw);
  zip.file('xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
    </Relationships>`);
  zip.file('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>
    </Relationships>`);
  zip.file('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
              xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
      <xdr:twoCellAnchor>
        <xdr:from><xdr:col>0</xdr:col><xdr:row>0</xdr:row></xdr:from>
        <xdr:to><xdr:col>10</xdr:col><xdr:row>12</xdr:row></xdr:to>
        <xdr:graphicFrame>
          <xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="独立图表"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
          <a:graphic><a:graphicData><c:chart r:id="rIdChart"/></a:graphicData></a:graphic>
        </xdr:graphicFrame>
      </xdr:twoCellAnchor>
    </xdr:wsDr>`);
  zip.file('xl/charts/chart1.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <c:chart>
        <c:title><c:tx><c:rich><a:p><a:r><a:t>仅存在于独立图表的战略目标标题</a:t></a:r></a:p></c:rich></c:tx></c:title>
      </c:chart>
    </c:chartSpace>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

// Synthetic PDF builder supporting text, /Rotate 90, and embedded/vector graphics
function makeSyntheticPdf(opts: {
  text?: string;
  rotate?: number;
  mediaBox?: [number, number, number, number];
  textPos?: [number, number];
  includeVectorDiagram?: boolean;
} = {}): Buffer {
  const { text = 'Strategy Map Goal: 12 stores in Q4', rotate = 0, mediaBox = [0, 0, 612, 792], textPos = [72, 720], includeVectorDiagram = false } = opts;
  const parts: string[] = [];
  if (includeVectorDiagram) {
    parts.push('q 1 0 0 1 0 0 cm 100 300 200 100 re S 300 350 m 400 350 l S 400 300 150 100 re f Q');
  }
  if (text) {
    parts.push(`BT /F1 14 Tf ${textPos[0]} ${textPos[1]} Td (${text}) Tj ET`);
  }
  const streamContent = parts.join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [${mediaBox.join(' ')}] ${rotate ? `/Rotate ${rotate} ` : ''}${text ? '/Resources << /Font << /F1 5 0 R >> >> ' : ''}/Contents 4 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Length ${Buffer.byteLength(streamContent)} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
    ...(text ? ['5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'] : []),
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

test('decodeStrategyMapImportFile parses PPTX in real presentation order and composes grpSp group transforms accurately', async () => {
  const pptx = await makeSyntheticPptx();
  const parsed = await decodeStrategyMapImportFile('会员运营复盘_2026Q1.pptx', pptx);
  assert.equal(parsed.format, 'pptx');
  assert.equal(parsed.pages.length, 4);
  assert.match(parsed.pages[0]!.title, /封面/);
  const p4 = parsed.pages[3]!;
  assert.equal(p4.page, 4);
  assert.ok(p4.shapes.some(s => s.text.includes('首购后 60–90 天分层培育')));
  assert.ok(p4.shapes.some(s => s.text.includes('提高新客 90 天二购率') && s.text.includes('约 9%')));
  assert.equal(p4.connectors.length, 1);
  assert.equal(p4.connectors[0]!.fromObjectId, '10');
  assert.equal(p4.connectors[0]!.toObjectId, '20');
  assert.equal(p4.connectors[0]!.arrowDirection, 'forward');

  // Verify translated + scaled grpSp child shape lands at exact [600, 400, 300, 133] (NOT raw [100, 133, 200, 133])
  const grouped = p4.shapes.find(s => s.objectId === '41');
  assert.ok(grouped, 'Expected grouped child shape #41');
  assert.deepEqual(grouped!.bbox, [600, 400, 300, 133]);
});

test('decodeStrategyMapImportFile binds XLSX drawings, charts, SmartArt, and multiple images strictly to their owning worksheet', async () => {
  const imgA = makeSolidPng(8, 6, 220, 40, 40);
  const imgB = makeSolidPng(12, 9, 40, 90, 220);
  const shaA = createHash('sha256').update(imgA).digest('hex');
  const shaB = createHash('sha256').update(imgB).digest('hex');
  const xlsx = await makeTwoSheetMixedXlsx(imgA, imgB);

  const parsed = await decodeStrategyMapImportFile('两表混排战略图.xlsx', xlsx);
  assert.equal(parsed.format, 'xlsx');
  // Exactly 2 pages matching the 2 visible worksheets — NO fake extra "绘图与 SmartArt 对象" page
  assert.equal(parsed.pages.length, 2);
  assert.equal(parsed.pages[0]!.sheetName, '目标表');
  assert.equal(parsed.pages[1]!.sheetName, '战略图示');

  // Sheet 1 has ONLY cells: 0 shapes, 0 images, needsVisualReview=false
  assert.equal(parsed.pages[0]!.shapes.length, 0);
  assert.equal(parsed.pages[0]!.embeddedImages?.length ?? 0, 0);
  assert.equal(parsed.pages[0]!.needsVisualReview, false);
  const sheet1Render = await renderImportPageImage({ fileName: '两表混排战略图.xlsx', format: 'xlsx', bytes: xlsx, page: 1, codeRoot: process.cwd() });
  assert.equal(sheet1Render.available, false, 'Sheet 1 must NOT receive Sheet 2 images');

  // Sheet 2 has textbox + chart title + SmartArt + BOTH distinct embedded images
  const p2 = parsed.pages[1]!;
  assert.equal(p2.needsVisualReview, true);
  assert.ok(p2.shapes.some(s => s.text.includes('图上写 15%')));
  assert.ok(p2.shapes.some(s => s.kind === 'chart' && s.text.includes('华东渠道净利率独有图表标题')));
  assert.ok(p2.shapes.some(s => s.kind === 'smartart' && s.text.includes('SmartArt 供应链协同节点')));
  assert.equal(p2.embeddedImages?.length, 2);
  assert.equal(p2.embeddedImages![0]!.sha256, shaA);
  assert.equal(p2.embeddedImages![1]!.sha256, shaB);

  // Sheet 2 image rendering selects exact image by imageIndex and supports returning both images
  const renderImg1 = await renderImportPageImage({ fileName: '两表混排战略图.xlsx', format: 'xlsx', bytes: xlsx, page: 2, codeRoot: process.cwd(), imageIndex: 1 });
  const renderImg2 = await renderImportPageImage({ fileName: '两表混排战略图.xlsx', format: 'xlsx', bytes: xlsx, page: 2, codeRoot: process.cwd(), imageIndex: 2 });
  assert.equal(renderImg1.available, true);
  assert.equal(renderImg2.available, true);
  assert.equal(createHash('sha256').update(Buffer.from(renderImg1.base64!, 'base64')).digest('hex'), shaA);
  assert.equal(createHash('sha256').update(Buffer.from(renderImg2.base64!, 'base64')).digest('hex'), shaB);

  const renderAll = await renderImportPageImage({ fileName: '两表混排战略图.xlsx', format: 'xlsx', bytes: xlsx, page: 2, codeRoot: process.cwd(), includeAllSheetImages: true });
  assert.equal(renderAll.available, true);
  assert.equal(renderAll.extraImages?.length, 1);
  assert.equal(createHash('sha256').update(Buffer.from(renderAll.extraImages![0]!.base64, 'base64')).digest('hex'), shaB);
});

test('decodeStrategyMapImportFile extracts title from standalone chart-only XLSX', async () => {
  const chartXlsx = await makeChartOnlyXlsx();
  const parsed = await decodeStrategyMapImportFile('纯图表战略.xlsx', chartXlsx);
  assert.equal(parsed.pages.length, 1);
  assert.ok(parsed.pages[0]!.shapes.some(s => s.kind === 'chart' && s.text.includes('仅存在于独立图表的战略目标标题')));
  assert.match(parsed.pages[0]!.text, /仅存在于独立图表的战略目标标题/);
  assert.equal(parsed.pages[0]!.needsVisualReview, true);
});

test('decodeStrategyMapImportFile maps rotated 90° PDF text coordinates accurately and flags mixed text+graphics PDFs for visual review', async () => {
  // Plain text PDF (no graphics, long text) -> needsVisualReview=false
  const plainPdf = await decodeStrategyMapImportFile('plain.pdf', makeSyntheticPdf({ text: 'Annual Retail Strategy Overview and Goal Definitions 2026' }));
  assert.equal(plainPdf.pages[0]!.hasTextLayer, true);
  assert.equal(plainPdf.pages[0]!.needsVisualReview, false);

  // Scan / no-text PDF -> needsVisualReview=true
  const scanPdf = await decodeStrategyMapImportFile('scan.pdf', makeSyntheticPdf({ text: '' }));
  assert.equal(scanPdf.pages[0]!.hasTextLayer, false);
  assert.equal(scanPdf.pages[0]!.needsVisualReview, true);

  // Mixed PDF with long title AND vector diagram boxes/arrows -> hasTextLayer=true AND needsVisualReview=true
  const mixedPdf = await decodeStrategyMapImportFile('mixed.pdf', makeSyntheticPdf({
    text: 'Long Title Strategy Map Document With Diagram Metrics Below',
    includeVectorDiagram: true,
  }));
  assert.equal(mixedPdf.pages[0]!.hasTextLayer, true);
  assert.equal(mixedPdf.pages[0]!.needsVisualReview, true);

  // Rotated 90° CW PDF: MediaBox [0,0,600,800], text at user-space (50, 700) renders on the RIGHT side (x ~ 875/1000)
  const rotatedPdf = await decodeStrategyMapImportFile('rotated90.pdf', makeSyntheticPdf({
    text: 'RightSideTarget',
    rotate: 90,
    mediaBox: [0, 0, 600, 800],
    textPos: [50, 700],
  }));
  const rotatedShape = rotatedPdf.pages[0]!.shapes.find(s => s.text.includes('RightSideTarget'));
  assert.ok(rotatedShape?.bbox, 'Expected bbox on rotated PDF text');
  assert.ok(rotatedShape!.bbox![0] >= 750, `Expected rotated 90° text on RIGHT side (x>=750), got ${JSON.stringify(rotatedShape!.bbox)}`);
  assert.ok(rotatedShape!.bbox![1] <= 200, `Expected rotated 90° text near TOP-RIGHT (y<=200), got ${JSON.stringify(rotatedShape!.bbox)}`);
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

    const v2ReplacedBytes = makeSyntheticJpeg(640, 480, 1);
    const { source: secondV2 } = await store.saveUpload(discussionId, '战略白板.jpg', v2ReplacedBytes);
    assert.notEqual(secondV2.sourceId, second.sourceId);
    assert.equal((await store.readBytes(discussionId, second.sourceId)).equals(v2Bytes), true);
    assert.equal((await store.readBytes(discussionId, secondV2.sourceId)).equals(v2ReplacedBytes), true);

    await store.revoke(discussionId, first.sourceId);
    await assert.rejects(() => store.readBytes(discussionId, first.sourceId), /strategy_map_import_revoked/);
    assert.equal((await store.readBytes(discussionId, second.sourceId)).equals(v2Bytes), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

async function makeSmartArtPptx(opts: { includeDrawingXml: boolean }): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
    </Types>`,
  );
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
    <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
      <p:sldSz cx="10000000" cy="10000000"/>
    </p:presentation>`,
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
    </Relationships>`,
  );
  zip.file(
    'ppt/slides/slide1.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:cSld><p:spTree>
        <p:graphicFrame>
          <p:nvGraphicFramePr><p:cNvPr id="5" name="SmartArt Diagram 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
          <p:xfrm><a:off x="0" y="650000"/><a:ext cx="6820000" cy="8700000"/></p:xfrm>
          <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram">
            <dgm:relIds r:dm="rIdData1"/>
          </a:graphicData></a:graphic>
        </p:graphicFrame>
      </p:spTree></p:cSld>
    </p:sld>`,
  );
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rIdData1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData" Target="../diagrams/data1.xml"/>
      ${opts.includeDrawingXml ? '<Relationship Id="rIdDraw1" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="../diagrams/drawing1.xml"/>' : ''}
    </Relationships>`,
  );
  zip.file(
    'ppt/diagrams/data1.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
    <dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram">
      <dgm:ptLst>
        <dgm:pt modelId="{ROOT}" type="doc"/>
        <dgm:pt modelId="{NODE-A}" type="node"><dgm:t><a:p><a:r><a:t>abc</a:t></a:r></a:p></dgm:t></dgm:pt>
        <dgm:pt modelId="{NODE-B}" type="node"><dgm:t><a:p><a:r><a:t>def</a:t></a:r></a:p></dgm:t></dgm:pt>
        <dgm:pt modelId="{NODE-C}" type="node"><dgm:t><a:p><a:r><a:t>ghi</a:t></a:r></a:p></dgm:t></dgm:pt>
      </dgm:ptLst>
      <dgm:extLst>
        <a:ext uri="http://schemas.microsoft.com/office/drawing/2008/diagram">
          <dsp:dataModelExt relId="rIdDraw1"/>
        </a:ext>
      </dgm:extLst>
    </dgm:dataModel>`,
  );
  if (opts.includeDrawingXml) {
    zip.file(
      'ppt/diagrams/drawing1.xml',
      `<?xml version="1.0" encoding="UTF-8"?>
      <dsp:drawing xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <dsp:spTree>
          <dsp:sp modelId="{NODE-A}">
            <dsp:nvSpPr><dsp:cNvPr id="101" name="Node A"/><dsp:cNvSpPr/></dsp:nvSpPr>
            <dsp:spPr><a:xfrm><a:off x="200000" y="300000"/><a:ext cx="6000000" cy="2000000"/></a:xfrm></dsp:spPr>
            <dsp:txBody><a:p><a:r><a:t>abc</a:t></a:r></a:p></dsp:txBody>
          </dsp:sp>
          <dsp:sp modelId="{NODE-B}">
            <dsp:nvSpPr><dsp:cNvPr id="102" name="Node B"/><dsp:cNvSpPr/></dsp:nvSpPr>
            <dsp:spPr><a:xfrm><a:off x="200000" y="3000000"/><a:ext cx="6000000" cy="2000000"/></a:xfrm></dsp:spPr>
            <dsp:txBody><a:p><a:r><a:t>def</a:t></a:r></a:p></dsp:txBody>
          </dsp:sp>
          <dsp:sp modelId="{NODE-C}">
            <dsp:nvSpPr><dsp:cNvPr id="103" name="Node C"/><dsp:cNvSpPr/></dsp:nvSpPr>
            <dsp:spPr><a:xfrm><a:off x="200000" y="5700000"/><a:ext cx="6000000" cy="2000000"/></a:xfrm></dsp:spPr>
            <dsp:txBody><a:p><a:r><a:t>ghi</a:t></a:r></a:p></dsp:txBody>
          </dsp:sp>
        </dsp:spTree>
      </dsp:drawing>`,
    );
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('Round-2 Item 7: PPTX SmartArt resolves per-child bboxes from drawing1.xml and sets needsVisualReview=true', async () => {
  const withDrawing = await makeSmartArtPptx({ includeDrawingXml: true });
  const parsed = await decodeStrategyMapImportFile('smartart-simple.pptx', withDrawing);
  assert.equal(parsed.pages.length, 1);
  const p1 = parsed.pages[0]!;
  assert.equal(p1.needsVisualReview, true, 'SmartArt slide MUST set needsVisualReview=true');

  const smartShapes = p1.shapes.filter(s => s.kind === 'smartart');
  assert.equal(smartShapes.length, 3);
  const a = smartShapes.find(s => s.text === 'abc')!;
  const b = smartShapes.find(s => s.text === 'def')!;
  const c = smartShapes.find(s => s.text === 'ghi')!;
  assert.ok(a && b && c);
  assert.equal(a.positionPrecision, 'item');
  assert.equal(b.positionPrecision, 'item');
  assert.equal(c.positionPrecision, 'item');
  // Frame y=650000 + child y=300000 / 3000000 / 5700000 -> distinct y coordinates 95, 365, 635 (NOT outer frame [0,65,682,870])
  assert.deepEqual(a.bbox, [20, 95, 600, 200]);
  assert.deepEqual(b.bbox, [20, 365, 600, 200]);
  assert.deepEqual(c.bbox, [20, 635, 600, 200]);
  assert.notDeepEqual(a.bbox, b.bbox);
  assert.notDeepEqual(b.bbox, c.bbox);
});

test('Round-2 Item 7: PPTX SmartArt without drawing.xml emits single group-level provenance instead of duplicating frame bbox onto every child', async () => {
  const withoutDrawing = await makeSmartArtPptx({ includeDrawingXml: false });
  const parsed = await decodeStrategyMapImportFile('smartart-no-drawing.pptx', withoutDrawing);
  const p1 = parsed.pages[0]!;
  assert.equal(p1.needsVisualReview, true, 'SmartArt slide MUST set needsVisualReview=true even without drawing.xml');

  const smartShapes = p1.shapes.filter(s => s.kind === 'smartart');
  assert.equal(smartShapes.length, 1, 'must NOT duplicate the outer graphicFrame bbox onto 3 separate child shapes');
  assert.equal(smartShapes[0]!.positionPrecision, 'group');
  assert.deepEqual(smartShapes[0]!.bbox, [0, 65, 682, 870]);
  assert.match(smartShapes[0]!.text, /abc/);
  assert.match(smartShapes[0]!.text, /def/);
  assert.match(smartShapes[0]!.text, /ghi/);
  assert.ok(p1.notes?.some(n => n.includes('图组') && n.includes('needs-review')));
});
