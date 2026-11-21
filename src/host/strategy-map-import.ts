import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { SaxesParser } from 'saxes';
import { StrategyDiscussionFault } from './strategy-discussion-store.ts';
import { inspectStrategyOfficeArchive } from './strategy-office-archive.ts';
import { decodeStrategyWorkbook } from './strategy-workbook.ts';
import type { StrategyWorkbook } from './strategy-workbook-types.ts';

const execFileAsync = promisify(execFile);

export type StrategyMapImportFormat = 'xlsx' | 'pptx' | 'pdf' | 'image';
export const STRATEGY_MAP_IMPORT_EXTENSIONS = ['.xlsx', '.pptx', '.pdf', '.png', '.jpg', '.jpeg'] as const;
export const STRATEGY_MAP_IMPORT_MAX_BYTES = 16 * 1024 * 1024;

export interface ImportImageMeta {
  width: number;
  height: number;
  orientation: number;
  mimeType: 'image/png' | 'image/jpeg';
}

export interface ParsedImportShape {
  objectId: string;
  name: string;
  text: string;
  /** Normalized 0..1000 coordinates [x, y, w, h] when known */
  bbox?: [number, number, number, number];
  kind?: 'shape' | 'smartart' | 'cell-anchor';
}

export interface ParsedImportConnector {
  objectId: string;
  name: string;
  fromObjectId?: string;
  toObjectId?: string;
  arrowDirection: 'forward' | 'backward' | 'both' | 'none';
  bbox?: [number, number, number, number];
}

export interface ParsedImportPage {
  page: number;
  title: string;
  text: string;
  hasTextLayer: boolean;
  needsVisualReview: boolean;
  shapes: ParsedImportShape[];
  connectors: ParsedImportConnector[];
  notes?: string[];
  sheetName?: string;
}

export interface ParsedEmbeddedImage {
  id: string;
  name: string;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  orientation: number;
  sha256: string;
}

export interface DecodedStrategyMapImport {
  format: StrategyMapImportFormat;
  fileName: string;
  sha256: string;
  bytesLength: number;
  pages: ParsedImportPage[];
  workbook?: StrategyWorkbook;
  imageMeta?: ImportImageMeta;
  embeddedImages?: ParsedEmbeddedImage[];
  hasDrawings?: boolean;
}

export interface RenderedPageImageResult {
  available: boolean;
  mimeType?: 'image/png' | 'image/jpeg';
  base64?: string;
  width?: number;
  height?: number;
  orientation?: number;
  renderer?: string;
  reason?: string;
}

const fault = (code: string, status = 422): never => {
  throw new StrategyDiscussionFault(code, status);
};

export function detectImportFormat(fileName: string): StrategyMapImportFormat {
  if (
    typeof fileName !== 'string' ||
    !fileName.trim() ||
    fileName.length > 250 ||
    /[\\/\u0000-\u001f\u007f]/.test(fileName)
  ) {
    return fault('strategy_map_import_format_unsupported', 400);
  }
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.xlsx') return 'xlsx';
  if (ext === '.pptx') return 'pptx';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') return 'image';
  return fault('strategy_map_import_format_unsupported', 400);
}

function readJpegExifOrientation(bytes: Buffer, start: number, length: number): number {
  const end = Math.min(bytes.length, start + length);
  if (start + 14 > end) return 1;
  if (bytes.subarray(start, start + 6).toString('ascii') !== 'Exif\0\0') return 1;
  const tiffStart = start + 6;
  const endian = bytes.subarray(tiffStart, tiffStart + 2).toString('ascii');
  const le = endian === 'II';
  if (!le && endian !== 'MM') return 1;
  const u16 = (off: number) => (le ? bytes.readUInt16LE(off) : bytes.readUInt16BE(off));
  const u32 = (off: number) => (le ? bytes.readUInt32LE(off) : bytes.readUInt32BE(off));
  if (u16(tiffStart + 2) !== 42) return 1;
  const ifdOffset = u32(tiffStart + 4);
  const ifdPos = tiffStart + ifdOffset;
  if (ifdPos + 2 > end) return 1;
  const entries = u16(ifdPos);
  for (let i = 0; i < entries; i++) {
    const entryPos = ifdPos + 2 + i * 12;
    if (entryPos + 12 > end) break;
    if (u16(entryPos) === 0x0112) {
      const value = u16(entryPos + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

export function inspectImageMetadata(fileName: string, bytes: Buffer): ImportImageMeta {
  const ext = path.extname(fileName).toLowerCase();
  if (!bytes.length || bytes.length > STRATEGY_MAP_IMPORT_MAX_BYTES) {
    return fault('strategy_map_import_too_large', 413);
  }
  const isPng =
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  if (isPng) {
    if (ext && ext !== '.png') return fault('strategy_map_import_invalid_image', 422);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (!width || !height || width > 30000 || height > 30000) return fault('strategy_map_import_invalid_image', 422);
    return { width, height, orientation: 1, mimeType: 'image/png' };
  }
  const isJpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (isJpeg) {
    if (ext && ext !== '.jpg' && ext !== '.jpeg') return fault('strategy_map_import_invalid_image', 422);
    let offset = 2;
    let width = 0;
    let height = 0;
    let orientation = 1;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      if (offset >= bytes.length) break;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break; // EOI or SOS
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const segLen = bytes.readUInt16BE(offset);
      if (segLen < 2 || offset + segLen > bytes.length) break;
      if (marker === 0xe1) {
        orientation = readJpegExifOrientation(bytes, offset + 2, segLen - 2);
      } else if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        if (segLen >= 7) {
          height = bytes.readUInt16BE(offset + 3);
          width = bytes.readUInt16BE(offset + 5);
        }
      }
      offset += segLen;
    }
    if (!width || !height || width > 30000 || height > 30000) return fault('strategy_map_import_invalid_image', 422);
    return { width, height, orientation, mimeType: 'image/jpeg' };
  }
  return fault('strategy_map_import_invalid_image', 422);
}

function parseXmlSafe(xml: string, handlers: {
  onOpen?: (local: string, attrs: Record<string, string>) => void;
  onText?: (text: string) => void;
  onClose?: (local: string) => void;
}) {
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => fault('strategy_map_import_invalid_document', 422));
  if (handlers.onOpen) {
    parser.on('opentag', tag => {
      const attrs: Record<string, string> = {};
      for (const [key, attr] of Object.entries(tag.attributes)) {
        const val = typeof attr === 'string' ? attr : attr.value;
        attrs[key] = val;
        const colon = key.indexOf(':');
        if (colon >= 0) attrs[key.slice(colon + 1)] = val;
      }
      handlers.onOpen!(tag.local, attrs);
    });
  }
  if (handlers.onText) parser.on('text', handlers.onText);
  if (handlers.onClose) parser.on('closetag', tag => handlers.onClose!(tag.local));
  parser.write(xml).close();
}

function normalizeBox(
  offX: number,
  offY: number,
  extCx: number,
  extCy: number,
  slideCx: number,
  slideCy: number,
): [number, number, number, number] | undefined {
  if (!slideCx || !slideCy || extCx <= 0 || extCy <= 0) return undefined;
  const clamp = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));
  return [
    clamp((offX / slideCx) * 1000),
    clamp((offY / slideCy) * 1000),
    clamp((extCx / slideCx) * 1000),
    clamp((extCy / slideCy) * 1000),
  ];
}

function parseSmartArtTexts(xml: string, prefix: string): ParsedImportShape[] {
  const shapes: ParsedImportShape[] = [];
  let inPt = false;
  let ptId = '';
  let inText = false;
  let paragraphs: string[] = [];
  let currentP = '';
  parseXmlSafe(xml, {
    onOpen(local, attrs) {
      if (local === 'pt') {
        inPt = true;
        ptId = attrs.modelId || `${prefix}-pt-${shapes.length + 1}`;
        paragraphs = [];
        currentP = '';
      } else if (inPt && local === 'p') {
        currentP = '';
      } else if (inPt && local === 't') {
        inText = true;
      }
    },
    onText(s) {
      if (inPt && inText) currentP += s;
    },
    onClose(local) {
      if (local === 't') inText = false;
      else if (inPt && local === 'p') {
        if (currentP.trim()) paragraphs.push(currentP.trim());
      } else if (inPt && local === 'pt') {
        const text = paragraphs.join('\n').trim();
        if (text) shapes.push({ objectId: ptId, name: `SmartArt · ${shapes.length + 1}`, text, kind: 'smartart' });
        inPt = false;
      }
    },
  });
  return shapes;
}

async function parsePptxImport(fileName: string, bytes: Buffer): Promise<DecodedStrategyMapImport> {
  await inspectStrategyOfficeArchive(bytes);
  const zip = await JSZip.loadAsync(bytes);
  const presFile = zip.file('ppt/presentation.xml');
  const relsFile = zip.file('ppt/_rels/presentation.xml.rels');
  if (!presFile || !relsFile) return fault('strategy_map_import_invalid_document', 422);

  const relTargets = new Map<string, string>();
  parseXmlSafe(await relsFile.async('string'), {
    onOpen(local, attrs) {
      if (local === 'Relationship' && attrs.Id && attrs.Target) {
        relTargets.set(attrs.Id, attrs.Target);
      }
    },
  });

  const slideRelIds: string[] = [];
  let slideCx = 12192000;
  let slideCy = 6858000;
  parseXmlSafe(await presFile.async('string'), {
    onOpen(local, attrs) {
      if (local === 'sldId' && attrs.id) {
        const rid = attrs['r:id'] ?? Object.entries(attrs).find(([k]) => k.endsWith(':id'))?.[1];
        if (rid) slideRelIds.push(rid);
      } else if (local === 'sldSz') {
        const cx = Number(attrs.cx), cy = Number(attrs.cy);
        if (Number.isFinite(cx) && cx > 0) slideCx = cx;
        if (Number.isFinite(cy) && cy > 0) slideCy = cy;
      }
    },
  });

  if (!slideRelIds.length || slideRelIds.length > 200) {
    return fault('strategy_map_import_invalid_document', 422);
  }

  const pages: ParsedImportPage[] = [];
  for (let i = 0; i < slideRelIds.length; i++) {
    const target = relTargets.get(slideRelIds[i]!) ?? '';
    const normalizedPath = target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join('ppt', target));
    const slideFile = zip.file(normalizedPath);
    if (!slideFile) continue;

    const shapes: ParsedImportShape[] = [];
    const connectors: ParsedImportConnector[] = [];

    type ActiveItem =
      | { kind: 'sp'; id: string; name: string; paragraphs: string[]; currentP: string; inText: boolean; x?: number; y?: number; cx?: number; cy?: number }
      | { kind: 'cxn'; id: string; name: string; fromId?: string; toId?: string; headArrow: boolean; tailArrow: boolean; x?: number; y?: number; cx?: number; cy?: number };

    let active: ActiveItem | null = null;
    let inSpPr = false;

    parseXmlSafe(await slideFile.async('string'), {
      onOpen(local, attrs) {
        if (local === 'sp') {
          active = { kind: 'sp', id: '', name: '', paragraphs: [], currentP: '', inText: false };
          inSpPr = false;
        } else if (local === 'cxnSp') {
          active = { kind: 'cxn', id: '', name: '', headArrow: false, tailArrow: false };
          inSpPr = false;
        } else if (active) {
          if (local === 'cNvPr' && !active.id) {
            active.id = attrs.id || `${active.kind}-${shapes.length + connectors.length + 1}`;
            active.name = attrs.name || active.id;
          } else if (local === 'spPr') {
            inSpPr = true;
          } else if (inSpPr && local === 'off') {
            active.x = Number(attrs.x);
            active.y = Number(attrs.y);
          } else if (inSpPr && local === 'ext') {
            active.cx = Number(attrs.cx);
            active.cy = Number(attrs.cy);
          } else if (active.kind === 'sp') {
            if (local === 'p') active.currentP = '';
            else if (local === 't') active.inText = true;
            else if (local === 'br') active.currentP += '\n';
          } else if (active.kind === 'cxn') {
            if (local === 'stCxn' && attrs.id) active.fromId = attrs.id;
            else if (local === 'endCxn' && attrs.id) active.toId = attrs.id;
            else if (local === 'headEnd' && attrs.type && attrs.type !== 'none') active.headArrow = true;
            else if (local === 'tailEnd' && attrs.type && attrs.type !== 'none') active.tailArrow = true;
          }
        }
      },
      onText(s) {
        if (active?.kind === 'sp' && active.inText) active.currentP += s;
      },
      onClose(local) {
        if (!active) return;
        if (local === 'spPr') inSpPr = false;
        if (active.kind === 'sp') {
          if (local === 't') active.inText = false;
          else if (local === 'p') {
            if (active.currentP.trim()) active.paragraphs.push(active.currentP.trim());
          } else if (local === 'sp') {
            const text = active.paragraphs.join('\n').trim();
            if (text) {
              shapes.push({
                objectId: active.id || `sp-${shapes.length + 1}`,
                name: active.name || `形状#${shapes.length + 1}`,
                text,
                bbox:
                  active.x !== undefined && active.y !== undefined && active.cx !== undefined && active.cy !== undefined
                    ? normalizeBox(active.x, active.y, active.cx, active.cy, slideCx, slideCy)
                    : undefined,
                kind: 'shape',
              });
            }
            active = null;
          }
        } else if (active.kind === 'cxn' && local === 'cxnSp') {
          const arrowDirection: ParsedImportConnector['arrowDirection'] =
            active.headArrow && active.tailArrow
              ? 'both'
              : active.tailArrow
                ? 'forward'
                : active.headArrow
                  ? 'backward'
                  : 'none';
          connectors.push({
            objectId: active.id || `cxn-${connectors.length + 1}`,
            name: active.name || `连接符#${connectors.length + 1}`,
            fromObjectId: active.fromId,
            toObjectId: active.toId,
            arrowDirection,
            bbox:
              active.x !== undefined && active.y !== undefined && active.cx !== undefined && active.cy !== undefined
                ? normalizeBox(active.x, active.y, active.cx, active.cy, slideCx, slideCy)
                : undefined,
          });
          active = null;
        }
      },
    });

    // Check slide relationships for linked SmartArt diagrams
    const slideBase = path.posix.basename(normalizedPath);
    const slideRelsFile = zip.file(path.posix.join(path.posix.dirname(normalizedPath), '_rels', `${slideBase}.rels`));
    if (slideRelsFile) {
      const diagramTargets: string[] = [];
      parseXmlSafe(await slideRelsFile.async('string'), {
        onOpen(local, attrs) {
          if (local === 'Relationship' && attrs.Target && /diagrams\/data\d*\.xml$/i.test(attrs.Target)) {
            diagramTargets.push(path.posix.normalize(path.posix.join(path.posix.dirname(normalizedPath), attrs.Target)));
          }
        },
      });
      for (const diagPath of diagramTargets) {
        const diagFile = zip.file(diagPath);
        if (diagFile) shapes.push(...parseSmartArtTexts(await diagFile.async('string'), `p${i + 1}-diag`));
      }
    }

    const fullText = shapes.map(s => s.text).join('\n');
    const title = shapes[0]?.text.split('\n')[0]?.slice(0, 60) || `第 ${i + 1} 页`;
    pages.push({
      page: i + 1,
      title,
      text: fullText,
      hasTextLayer: fullText.trim().length > 0,
      needsVisualReview: shapes.length === 0 || connectors.some(c => !c.fromObjectId || !c.toObjectId),
      shapes,
      connectors,
    });
  }

  return {
    format: 'pptx',
    fileName,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytesLength: bytes.byteLength,
    pages,
    hasDrawings: true,
  };
}

async function parseXlsxImport(fileName: string, bytes: Buffer): Promise<DecodedStrategyMapImport> {
  const workbook = await decodeStrategyWorkbook(fileName, bytes);
  const zip = await JSZip.loadAsync(bytes);

  const drawingShapes: ParsedImportShape[] = [];
  const drawingConnectors: ParsedImportConnector[] = [];

  for (const entryPath of Object.keys(zip.files).sort()) {
    if (/^xl\/drawings\/drawing\d*\.xml$/i.test(entryPath)) {
      const xml = await zip.file(entryPath)!.async('string');
      let anchorFromCol = 0, anchorFromRow = 0, anchorToCol = 4, anchorToRow = 4;
      let inFrom = false, inTo = false, activeTag = '';
      let activeSp: { id: string; name: string; paragraphs: string[]; currentP: string; inText: boolean } | null = null;
      let activeCxn: { id: string; name: string; fromId?: string; toId?: string; headArrow: boolean; tailArrow: boolean } | null = null;
      parseXmlSafe(xml, {
        onOpen(local, attrs) {
          if (local === 'from') { inFrom = true; }
          else if (local === 'to') { inTo = true; }
          else if (local === 'col' || local === 'row') { activeTag = local; }
          else if (local === 'sp') { activeSp = { id: '', name: '', paragraphs: [], currentP: '', inText: false }; }
          else if (local === 'cxnSp') { activeCxn = { id: '', name: '', headArrow: false, tailArrow: false }; }
          else if (activeSp) {
            if (local === 'cNvPr' && !activeSp.id) {
              activeSp.id = attrs.id || `shape-${drawingShapes.length + 1}`;
              activeSp.name = attrs.name || `形状#${drawingShapes.length + 1}`;
            } else if (local === 'p') activeSp.currentP = '';
            else if (local === 't') activeSp.inText = true;
          } else if (activeCxn) {
            if (local === 'cNvPr' && !activeCxn.id) {
              activeCxn.id = attrs.id || `cxn-${drawingConnectors.length + 1}`;
              activeCxn.name = attrs.name || `连接符#${drawingConnectors.length + 1}`;
            } else if (local === 'stCxn' && attrs.id) activeCxn.fromId = attrs.id;
            else if (local === 'endCxn' && attrs.id) activeCxn.toId = attrs.id;
            else if (local === 'headEnd' && attrs.type && attrs.type !== 'none') activeCxn.headArrow = true;
            else if (local === 'tailEnd' && attrs.type && attrs.type !== 'none') activeCxn.tailArrow = true;
          }
        },
        onText(s) {
          if (activeSp?.inText) activeSp.currentP += s;
          else if (inFrom && activeTag === 'col') anchorFromCol = Number(s) || 0;
          else if (inFrom && activeTag === 'row') anchorFromRow = Number(s) || 0;
          else if (inTo && activeTag === 'col') anchorToCol = Number(s) || 0;
          else if (inTo && activeTag === 'row') anchorToRow = Number(s) || 0;
        },
        onClose(local) {
          if (local === 'from') inFrom = false;
          else if (local === 'to') inTo = false;
          else if (local === 'col' || local === 'row') activeTag = '';
          else if (activeSp) {
            if (local === 't') activeSp.inText = false;
            else if (local === 'p') { if (activeSp.currentP.trim()) activeSp.paragraphs.push(activeSp.currentP.trim()); }
            else if (local === 'sp') {
              const text = activeSp.paragraphs.join('\n').trim();
              if (text) {
                drawingShapes.push({
                  objectId: activeSp.id || `shape-${drawingShapes.length + 1}`,
                  name: activeSp.name || `形状#${drawingShapes.length + 1}`,
                  text,
                  bbox: [
                    Math.min(900, anchorFromCol * 70),
                    Math.min(900, anchorFromRow * 45),
                    Math.max(120, Math.min(500, Math.max(1, anchorToCol - anchorFromCol) * 70)),
                    Math.max(60, Math.min(350, Math.max(1, anchorToRow - anchorFromRow) * 45)),
                  ],
                  kind: 'shape',
                });
              }
              activeSp = null;
            }
          } else if (activeCxn && local === 'cxnSp') {
            drawingConnectors.push({
              objectId: activeCxn.id || `cxn-${drawingConnectors.length + 1}`,
              name: activeCxn.name,
              fromObjectId: activeCxn.fromId,
              toObjectId: activeCxn.toId,
              arrowDirection:
                activeCxn.headArrow && activeCxn.tailArrow ? 'both'
                : activeCxn.tailArrow ? 'forward'
                : activeCxn.headArrow ? 'backward'
                : 'none',
            });
            activeCxn = null;
          }
        },
      });
    } else if (/^xl\/diagrams\/data\d*\.xml$/i.test(entryPath)) {
      drawingShapes.push(...parseSmartArtTexts(await zip.file(entryPath)!.async('string'), 'xlsx-smartart'));
    }
  }

  const embeddedImages: ParsedEmbeddedImage[] = [];
  for (const entryPath of Object.keys(zip.files).sort()) {
    if (/^xl\/media\/.+\.(png|jpe?g)$/i.test(entryPath)) {
      const mediaBytes = await zip.file(entryPath)!.async('nodebuffer');
      try {
        const meta = inspectImageMetadata(path.posix.basename(entryPath), mediaBytes);
        embeddedImages.push({
          id: `media-${embeddedImages.length + 1}`,
          name: path.posix.basename(entryPath),
          mimeType: meta.mimeType,
          width: meta.width,
          height: meta.height,
          orientation: meta.orientation,
          sha256: createHash('sha256').update(mediaBytes).digest('hex'),
        });
      } catch {
        // Skip unreadable media entries without failing the workbook
      }
    }
  }

  const pages: ParsedImportPage[] = workbook.sheets.map((sheet, idx) => {
    const text = sheet.rows.map(r => `第 ${r.row} 行: ${Object.entries(r.values).map(([c, v]) => `${c}=${v}`).join(' | ')}`).join('\n');
    return {
      page: idx + 1,
      title: `工作表 · ${sheet.name}`,
      sheetName: sheet.name,
      text,
      hasTextLayer: text.trim().length > 0,
      needsVisualReview: Boolean(workbook.drawings && !sheet.rows.length),
      shapes: idx === 0 ? drawingShapes : [],
      connectors: idx === 0 ? drawingConnectors : [],
    };
  });

  if (!pages.length || (drawingShapes.length && pages.length > 1)) {
    pages.push({
      page: pages.length + 1,
      title: '绘图与 SmartArt 对象',
      text: drawingShapes.map(s => `${s.name}: ${s.text}`).join('\n'),
      hasTextLayer: drawingShapes.length > 0,
      needsVisualReview: embeddedImages.length > 0,
      shapes: drawingShapes,
      connectors: drawingConnectors,
    });
  }

  return {
    format: 'xlsx',
    fileName,
    sha256: workbook.sha256,
    bytesLength: bytes.byteLength,
    pages,
    workbook,
    embeddedImages,
    hasDrawings: Boolean(workbook.drawings || drawingShapes.length || embeddedImages.length),
  };
}

async function parsePdfImport(fileName: string, bytes: Buffer): Promise<DecodedStrategyMapImport> {
  if (!bytes.length || bytes.length > STRATEGY_MAP_IMPORT_MAX_BYTES) {
    return fault('strategy_map_import_too_large', 413);
  }
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfRoot = path.dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));
  const loading = getDocument({
    data: new Uint8Array(bytes),
    cMapUrl: path.join(pdfRoot, 'cmaps') + path.sep,
    cMapPacked: true,
    standardFontDataUrl: path.join(pdfRoot, 'standard_fonts') + path.sep,
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
  });
  const pages: ParsedImportPage[] = [];
  try {
    const pdf = await loading.promise;
    if (pdf.numPages < 1 || pdf.numPages > 200) return fault('strategy_map_import_page_limit', 413);
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const shapes: ParsedImportShape[] = [];
      const pieces: string[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const s = item.str.trim();
        pieces.push(item.str + (item.hasEOL ? '\n' : ' '));
        if (s && Array.isArray(item.transform) && item.transform.length >= 6 && viewport.width > 0 && viewport.height > 0) {
          const x = Math.max(0, Math.min(980, Math.round((item.transform[4]! / viewport.width) * 1000)));
          const y = Math.max(0, Math.min(980, Math.round(((viewport.height - item.transform[5]!) / viewport.height) * 1000)));
          const w = Math.max(40, Math.min(1000 - x, Math.round(((item.width || 60) / viewport.width) * 1000)));
          const h = Math.max(24, Math.min(1000 - y, Math.round(((item.height || 14) / viewport.height) * 1000)));
          if (shapes.length < 120) {
            shapes.push({ objectId: `p${i}-t${shapes.length + 1}`, name: `第 ${i} 页文本#${shapes.length + 1}`, text: s, bbox: [x, y, w, h], kind: 'shape' });
          }
        }
      }
      const text = pieces.join('').trim();
      const hasTextLayer = text.length > 0;
      pages.push({
        page: i,
        title: hasTextLayer ? `第 ${i} 页 · ${text.split('\n')[0]!.slice(0, 40)}` : `第 ${i} 页 · 扫描/纯图页`,
        text,
        hasTextLayer,
        needsVisualReview: !hasTextLayer || text.length < 20,
        shapes,
        connectors: [],
        notes: !hasTextLayer ? ['本页无可读文字层（扫描页或纯图），建议视觉模型读取或对照原稿核对。'] : undefined,
      });
      page.cleanup();
    }
  } catch (error) {
    if (error instanceof StrategyDiscussionFault) throw error;
    return fault('strategy_map_import_pdf_unreadable', 422);
  } finally {
    await loading.destroy();
  }

  return {
    format: 'pdf',
    fileName,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytesLength: bytes.byteLength,
    pages,
  };
}

export async function decodeStrategyMapImportFile(fileName: string, bytes: Buffer): Promise<DecodedStrategyMapImport> {
  const format = detectImportFormat(fileName);
  if (!bytes.length || bytes.length > STRATEGY_MAP_IMPORT_MAX_BYTES) {
    return fault('strategy_map_import_too_large', 413);
  }
  if (format === 'image') {
    const meta = inspectImageMetadata(fileName, bytes);
    return {
      format: 'image',
      fileName,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytesLength: bytes.byteLength,
      imageMeta: meta,
      pages: [
        {
          page: 1,
          title: `原图（${meta.width}×${meta.height} · 方向 ${meta.orientation}）`,
          text: '',
          hasTextLayer: false,
          needsVisualReview: true,
          shapes: [],
          connectors: [],
        },
      ],
    };
  }
  if (format === 'pptx') return parsePptxImport(fileName, bytes);
  if (format === 'xlsx') return parseXlsxImport(fileName, bytes);
  return parsePdfImport(fileName, bytes);
}

/**
 * On-demand page image rendering.
 * Reuses extensions/analysis-assets/ppt-report/scripts/page_images.py for PPTX,
 * native bytes for PNG/JPEG, embedded images for XLSX, and pdftoppm/pypdfium2 for PDF.
 * Cleanly reports unavailable renderer instead of throwing or blocking native extraction.
 */
export async function renderImportPageImage(options: {
  fileName: string;
  format: StrategyMapImportFormat;
  bytes: Buffer;
  page: number;
  codeRoot: string;
}): Promise<RenderedPageImageResult> {
  const { fileName, format, bytes, page, codeRoot } = options;
  if (format === 'image') {
    const meta = inspectImageMetadata(fileName, bytes);
    return {
      available: true,
      mimeType: meta.mimeType,
      base64: bytes.toString('base64'),
      width: meta.width,
      height: meta.height,
      orientation: meta.orientation,
      renderer: 'original-image-bytes',
    };
  }
  if (format === 'xlsx') {
    const zip = await JSZip.loadAsync(bytes);
    const media = Object.keys(zip.files).filter(f => /^xl\/media\/.+\.(png|jpe?g)$/i.test(f)).sort();
    const target = media[page - 1] ?? media[0];
    if (target) {
      const imgBytes = await zip.file(target)!.async('nodebuffer');
      const meta = inspectImageMetadata(path.posix.basename(target), imgBytes);
      return {
        available: true,
        mimeType: meta.mimeType,
        base64: imgBytes.toString('base64'),
        width: meta.width,
        height: meta.height,
        orientation: meta.orientation,
        renderer: 'xlsx-embedded-media',
      };
    }
    return { available: false, reason: '当前工作簿无嵌入图片；已提供结构化表与原生绘图形状供核对。' };
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'optracall-import-render-'));
  try {
    if (format === 'pptx') {
      const script = path.join(codeRoot, 'extensions/analysis-assets/ppt-report/scripts/page_images.py');
      const deckPath = path.join(tmpDir, 'deck.pptx');
      const outDir = path.join(tmpDir, 'out');
      await writeFile(deckPath, bytes, { mode: 0o600 });
      try {
        await execFileAsync('python3', [script, '--deck', deckPath, '--out', outDir, '--width', '1280'], { timeout: 90_000 });
      } catch (err) {
        const stderr = err && typeof err === 'object' && 'stderr' in err ? String((err as { stderr?: unknown }).stderr ?? '') : '';
        return {
          available: false,
          reason: stderr.includes('soffice') || stderr.includes('pypdfium2')
            ? '本机未检测到 LibreOffice 或 pypdfium2 渲染环境，已使用原生幻灯片形状/文字/连接符；可结合原稿手工核对。'
            : 'PPT 整页渲染暂不可用，已回退原生形状/文字/连接符供核对。',
        };
      }
      const imgPath = path.join(outDir, `slide-${String(page).padStart(2, '0')}.png`);
      const pngBytes = await readFile(imgPath);
      const meta = inspectImageMetadata('slide.png', pngBytes);
      return {
        available: true,
        mimeType: 'image/png',
        base64: pngBytes.toString('base64'),
        width: meta.width,
        height: meta.height,
        orientation: 1,
        renderer: 'ppt-report/page_images.py (LibreOffice + pypdfium2)',
      };
    }

    if (format === 'pdf') {
      const pdfPath = path.join(tmpDir, 'doc.pdf');
      const outPrefix = path.join(tmpDir, 'page');
      await writeFile(pdfPath, bytes, { mode: 0o600 });
      try {
        await execFileAsync('pdftoppm', ['-png', '-r', '144', '-f', String(page), '-l', String(page), '-singlefile', pdfPath, outPrefix], { timeout: 60_000 });
        const pngBytes = await readFile(`${outPrefix}.png`);
        const meta = inspectImageMetadata('page.png', pngBytes);
        return {
          available: true,
          mimeType: 'image/png',
          base64: pngBytes.toString('base64'),
          width: meta.width,
          height: meta.height,
          orientation: 1,
          renderer: 'pdftoppm',
        };
      } catch {
        // Fallback: try python3 + pypdfium2
        try {
          const outPng = `${outPrefix}.png`;
          await execFileAsync('python3', [
            '-c',
            'import sys, pypdfium2 as p; doc=p.PdfDocument(sys.argv[1]); pg=doc[int(sys.argv[2])-1]; w,h=pg.get_size(); pg.render(scale=min(2.0,1280/max(1,w))).to_pil().save(sys.argv[3])',
            pdfPath,
            String(page),
            outPng,
          ], { timeout: 60_000 });
          const pngBytes = await readFile(outPng);
          const meta = inspectImageMetadata('page.png', pngBytes);
          return {
            available: true,
            mimeType: 'image/png',
            base64: pngBytes.toString('base64'),
            width: meta.width,
            height: meta.height,
            orientation: 1,
            renderer: 'pypdfium2',
          };
        } catch {
          return {
            available: false,
            reason: '本机未检测到 PDF 页图渲染器（pdftoppm / pypdfium2），已提取 PDF 文字层；扫描页可对照原稿手工核对。',
          };
        }
      }
    }
    return { available: false, reason: '当前格式暂不支持整页图渲染。' };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
