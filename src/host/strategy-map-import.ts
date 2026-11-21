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
  kind?: 'shape' | 'smartart' | 'chart' | 'image' | 'cell-anchor';
}

export interface ParsedImportConnector {
  objectId: string;
  name: string;
  fromObjectId?: string;
  toObjectId?: string;
  arrowDirection: 'forward' | 'backward' | 'both' | 'none';
  bbox?: [number, number, number, number];
}

export interface ParsedEmbeddedImage {
  id: string;
  name: string;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  orientation: number;
  sha256: string;
  page?: number;
  sheetName?: string;
  objectId?: string;
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
  embeddedImages?: ParsedEmbeddedImage[];
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
  imageId?: string;
  imageName?: string;
  imageIndex?: number;
  totalSheetImages?: number;
  extraImages?: Array<{
    imageId: string;
    imageName: string;
    mimeType: 'image/png' | 'image/jpeg';
    base64: string;
    width: number;
    height: number;
    orientation: number;
  }>;
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

function resolveZipTarget(baseDir: string, target: string): string {
  const cleaned = target.replace(/\\/g, '/');
  if (cleaned.startsWith('/')) return path.posix.normalize(cleaned.slice(1));
  return path.posix.normalize(path.posix.join(baseDir, cleaned));
}

async function parseZipRels(
  zip: JSZip,
  ownerPath: string,
): Promise<Map<string, { target: string; type: string }>> {
  const baseDir = path.posix.dirname(ownerPath);
  const relsPath = path.posix.join(baseDir, '_rels', `${path.posix.basename(ownerPath)}.rels`);
  const relsFile = zip.file(relsPath);
  const result = new Map<string, { target: string; type: string }>();
  if (!relsFile) return result;
  parseXmlSafe(await relsFile.async('string'), {
    onOpen(local, attrs) {
      if (local !== 'Relationship' || !attrs.Id || !attrs.Target) return;
      if (attrs.TargetMode?.toLowerCase() === 'external') return;
      result.set(attrs.Id, {
        target: resolveZipTarget(baseDir, attrs.Target),
        type: attrs.Type ?? '',
      });
    },
  });
  return result;
}

function normalizeBox(
  offX: number,
  offY: number,
  extCx: number,
  extCy: number,
  canvasCx: number,
  canvasCy: number,
): [number, number, number, number] | undefined {
  if (!Number.isFinite(offX) || !Number.isFinite(offY) || !Number.isFinite(extCx) || !Number.isFinite(extCy)) return undefined;
  if (!canvasCx || !canvasCy || extCx <= 0 || extCy <= 0) return undefined;
  const clamp = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));
  const x1 = clamp((offX / canvasCx) * 1000);
  const y1 = clamp((offY / canvasCy) * 1000);
  const x2 = clamp(((offX + extCx) / canvasCx) * 1000);
  const y2 = clamp(((offY + extCy) / canvasCy) * 1000);
  const w = x2 - x1;
  const h = y2 - y1;
  if (w <= 0 || h <= 0) return undefined;
  return [x1, y1, w, h];
}

interface GroupTransform {
  gx: number;
  gy: number;
  gcx: number;
  gcy: number;
  chx: number;
  chy: number;
  chcx: number;
  chcy: number;
  flipH: boolean;
  flipV: boolean;
  rotDeg: number;
}

function applyRectRotation(
  box: { x: number; y: number; cx: number; cy: number },
  rotDeg: number,
  centerX?: number,
  centerY?: number,
): { x: number; y: number; cx: number; cy: number } {
  if (!rotDeg || Math.abs(rotDeg % 360) < 1e-6) return box;
  const rad = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx0 = centerX ?? box.x + box.cx / 2;
  const cy0 = centerY ?? box.y + box.cy / 2;
  const corners = [
    [box.x, box.y],
    [box.x + box.cx, box.y],
    [box.x + box.cx, box.y + box.cy],
    [box.x, box.y + box.cy],
  ].map(([px, py]) => {
    const dx = px! - cx0;
    const dy = py! - cy0;
    return [cx0 + dx * cos - dy * sin, cy0 + dx * sin + dy * cos];
  });
  const xs = corners.map(c => c[0]!);
  const ys = corners.map(c => c[1]!);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, cx: Math.max(...xs) - minX, cy: Math.max(...ys) - minY };
}

function applyGroupTransforms(
  box: { x: number; y: number; cx: number; cy: number },
  stack: readonly GroupTransform[],
): { x: number; y: number; cx: number; cy: number } {
  let current = { ...box };
  for (let i = stack.length - 1; i >= 0; i--) {
    const g = stack[i]!;
    if (!(g.gcx > 0 && g.gcy > 0 && g.chcx > 0 && g.chcy > 0)) continue;
    const sx = g.gcx / g.chcx;
    const sy = g.gcy / g.chcy;
    const relX = g.flipH ? g.chx + g.chcx - (current.x + current.cx) : current.x - g.chx;
    const relY = g.flipV ? g.chy + g.chcy - (current.y + current.cy) : current.y - g.chy;
    current = {
      x: g.gx + relX * sx,
      y: g.gy + relY * sy,
      cx: current.cx * sx,
      cy: current.cy * sy,
    };
    if (g.rotDeg) {
      current = applyRectRotation(current, g.rotDeg, g.gx + g.gcx / 2, g.gy + g.gcy / 2);
    }
  }
  return current;
}

function parseSmartArtTexts(
  xml: string,
  prefix: string,
  fallbackBbox?: [number, number, number, number],
): ParsedImportShape[] {
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
        if (text) {
          shapes.push({
            objectId: ptId,
            name: `SmartArt · ${shapes.length + 1}`,
            text,
            ...(fallbackBbox ? { bbox: fallbackBbox } : {}),
            kind: 'smartart',
          });
        }
        inPt = false;
      }
    },
  });
  return shapes;
}

function parseChartXml(
  xml: string,
  objectId: string,
  fallbackName: string,
  bbox?: [number, number, number, number],
): ParsedImportShape | undefined {
  const titleParts: string[] = [];
  const axisTitles: string[] = [];
  const seriesNames: string[] = [];
  const categories: string[] = [];
  const stack: string[] = [];
  let currentText = '';
  let inLeafText = false;

  parseXmlSafe(xml, {
    onOpen(local) {
      stack.push(local);
      if (local === 't' || local === 'v') {
        inLeafText = true;
        currentText = '';
      }
    },
    onText(s) {
      if (inLeafText) currentText += s;
    },
    onClose(local) {
      if (local === 't' || local === 'v') {
        const val = currentText.trim();
        if (val) {
          const inAxis = stack.includes('catAx') || stack.includes('valAx') || stack.includes('dateAx') || stack.includes('serAx');
          const inTitle = stack.includes('title');
          const inSer = stack.includes('ser');
          const inTx = stack.includes('tx');
          const inCat = stack.includes('cat');
          if (inTitle && !inAxis) {
            if (!titleParts.includes(val)) titleParts.push(val);
          } else if (inTitle && inAxis) {
            if (!axisTitles.includes(val)) axisTitles.push(val);
          } else if (inSer && inTx) {
            if (!seriesNames.includes(val)) seriesNames.push(val);
          } else if (inSer && inCat && categories.length < 24) {
            if (!categories.includes(val)) categories.push(val);
          }
        }
        inLeafText = false;
        currentText = '';
      }
      stack.pop();
    },
  });

  const mainTitle = titleParts.join(' ').trim();
  const lines: string[] = [];
  if (mainTitle) lines.push(`图表标题：${mainTitle}`);
  if (axisTitles.length) lines.push(`坐标轴：${axisTitles.join(' / ')}`);
  if (seriesNames.length) lines.push(`系列：${seriesNames.join('、')}`);
  if (categories.length) lines.push(`分类项：${categories.join('、')}`);
  const text = lines.join('\n').trim();
  if (!text) return undefined;
  return {
    objectId,
    name: mainTitle ? `图表 · ${mainTitle}` : fallbackName,
    text,
    ...(bbox ? { bbox } : {}),
    kind: 'chart',
  };
}

async function parsePptxImport(fileName: string, bytes: Buffer): Promise<DecodedStrategyMapImport> {
  await inspectStrategyOfficeArchive(bytes);
  const zip = await JSZip.loadAsync(bytes);
  const presFile = zip.file('ppt/presentation.xml');
  if (!presFile) return fault('strategy_map_import_invalid_document', 422);
  const relTargets = await parseZipRels(zip, 'ppt/presentation.xml');
  if (!relTargets.size) return fault('strategy_map_import_invalid_document', 422);

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
    const rel = relTargets.get(slideRelIds[i]!);
    if (!rel) continue;
    const normalizedPath = rel.target;
    const slideFile = zip.file(normalizedPath);
    if (!slideFile) continue;

    const slideRels = await parseZipRels(zip, normalizedPath);
    const shapes: ParsedImportShape[] = [];
    const connectors: ParsedImportConnector[] = [];
    const linkedChartRefs: Array<{ relId: string; objectId: string; name: string; bbox?: [number, number, number, number] }> = [];
    const linkedDiagramRefs: Array<{ relId: string; bbox?: [number, number, number, number] }> = [];
    let hasSlidePictures = false;

    type ActiveItem =
      | { kind: 'sp'; id: string; name: string; paragraphs: string[]; currentP: string; inText: boolean; x?: number; y?: number; cx?: number; cy?: number; rotDeg: number }
      | { kind: 'cxn'; id: string; name: string; fromId?: string; toId?: string; headArrow: boolean; tailArrow: boolean; x?: number; y?: number; cx?: number; cy?: number; rotDeg: number }
      | { kind: 'graphicFrame'; id: string; name: string; x?: number; y?: number; cx?: number; cy?: number; rotDeg: number; chartRelId?: string; diagramRelId?: string; tableRows: string[][]; currentRow: string[]; currentCell: string; inTableText: boolean };

    let active: ActiveItem | null = null;
    let inSpPr = false;
    let inFrameXfrm = false;
    let inGrpSpPr = false;
    let inSpTree = false;
    const groupStack: GroupTransform[] = [];
    const groupDepthStack: boolean[] = []; // true for grpSp, false for spTree

    parseXmlSafe(await slideFile.async('string'), {
      onOpen(local, attrs) {
        if (local === 'spTree') {
          inSpTree = true;
          groupDepthStack.push(false);
        } else if (local === 'grpSp') {
          groupDepthStack.push(true);
          groupStack.push({ gx: 0, gy: 0, gcx: 0, gcy: 0, chx: 0, chy: 0, chcx: 0, chcy: 0, flipH: false, flipV: false, rotDeg: 0 });
        } else if (local === 'grpSpPr') {
          inGrpSpPr = true;
        } else if (inGrpSpPr && groupDepthStack.at(-1) === true && groupStack.length > 0) {
          const top = groupStack[groupStack.length - 1]!;
          if (local === 'xfrm') {
            top.flipH = attrs.flipH === '1' || attrs.flipH === 'true';
            top.flipV = attrs.flipV === '1' || attrs.flipV === 'true';
            top.rotDeg = attrs.rot ? Number(attrs.rot) / 60000 : 0;
          } else if (local === 'off') {
            top.gx = Number(attrs.x) || 0;
            top.gy = Number(attrs.y) || 0;
          } else if (local === 'ext') {
            top.gcx = Number(attrs.cx) || 0;
            top.gcy = Number(attrs.cy) || 0;
          } else if (local === 'chOff') {
            top.chx = Number(attrs.x) || 0;
            top.chy = Number(attrs.y) || 0;
          } else if (local === 'chExt') {
            top.chcx = Number(attrs.cx) || 0;
            top.chcy = Number(attrs.cy) || 0;
          }
        } else if (local === 'pic' && inSpTree) {
          hasSlidePictures = true;
        } else if (local === 'sp') {
          active = { kind: 'sp', id: '', name: '', paragraphs: [], currentP: '', inText: false, rotDeg: 0 };
          inSpPr = false;
        } else if (local === 'cxnSp') {
          active = { kind: 'cxn', id: '', name: '', headArrow: false, tailArrow: false, rotDeg: 0 };
          inSpPr = false;
        } else if (local === 'graphicFrame') {
          active = { kind: 'graphicFrame', id: '', name: '', rotDeg: 0, tableRows: [], currentRow: [], currentCell: '', inTableText: false };
          inFrameXfrm = false;
        } else if (active) {
          if (local === 'cNvPr' && !active.id) {
            active.id = attrs.id || `${active.kind}-${shapes.length + connectors.length + 1}`;
            active.name = attrs.name || active.id;
          } else if (active.kind === 'graphicFrame') {
            if (local === 'xfrm') {
              inFrameXfrm = true;
              active.rotDeg = attrs.rot ? Number(attrs.rot) / 60000 : 0;
            } else if (inFrameXfrm && local === 'off') {
              active.x = Number(attrs.x);
              active.y = Number(attrs.y);
            } else if (inFrameXfrm && local === 'ext') {
              active.cx = Number(attrs.cx);
              active.cy = Number(attrs.cy);
            } else if (local === 'chart') {
              const rid = attrs['r:id'] ?? attrs.id;
              if (rid) active.chartRelId = rid;
            } else if (local === 'relIds') {
              const dm = attrs['r:dm'] ?? attrs.dm;
              if (dm) active.diagramRelId = dm;
            } else if (local === 'tr') {
              active.currentRow = [];
            } else if (local === 'tc') {
              active.currentCell = '';
            } else if (local === 't') {
              active.inTableText = true;
            }
          } else if (local === 'spPr') {
            inSpPr = true;
          } else if (inSpPr && local === 'xfrm') {
            active.rotDeg = attrs.rot ? Number(attrs.rot) / 60000 : 0;
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
        else if (active?.kind === 'graphicFrame' && active.inTableText) active.currentCell += s;
      },
      onClose(local) {
        if (local === 'grpSpPr') {
          inGrpSpPr = false;
          return;
        }
        if (local === 'grpSp') {
          if (groupDepthStack.at(-1) === true) {
            groupDepthStack.pop();
            groupStack.pop();
          }
          return;
        }
        if (local === 'spTree') {
          inSpTree = false;
          if (groupDepthStack.at(-1) === false) groupDepthStack.pop();
          return;
        }
        if (!active) return;
        if (local === 'spPr') inSpPr = false;
        if (active.kind === 'graphicFrame') {
          if (local === 'xfrm') inFrameXfrm = false;
          else if (local === 't') active.inTableText = false;
          else if (local === 'tc') active.currentRow.push(active.currentCell.trim());
          else if (local === 'tr') {
            if (active.currentRow.some(Boolean)) active.tableRows.push(active.currentRow);
          } else if (local === 'graphicFrame') {
            let bbox: [number, number, number, number] | undefined;
            if (active.x !== undefined && active.y !== undefined && active.cx !== undefined && active.cy !== undefined) {
              const rotated = applyRectRotation({ x: active.x, y: active.y, cx: active.cx, cy: active.cy }, active.rotDeg);
              const mapped = applyGroupTransforms(rotated, groupStack);
              bbox = normalizeBox(mapped.x, mapped.y, mapped.cx, mapped.cy, slideCx, slideCy);
            }
            if (active.chartRelId) {
              linkedChartRefs.push({ relId: active.chartRelId, objectId: active.id || `chart-${shapes.length + 1}`, name: active.name || '图表', bbox });
            } else if (active.diagramRelId) {
              linkedDiagramRefs.push({ relId: active.diagramRelId, bbox });
            } else if (active.tableRows.length) {
              shapes.push({
                objectId: active.id || `tbl-${shapes.length + 1}`,
                name: active.name || `表格#${shapes.length + 1}`,
                text: active.tableRows.map(r => r.join(' | ')).join('\n'),
                bbox,
                kind: 'shape',
              });
            }
            active = null;
          }
          return;
        }
        if (active.kind === 'sp') {
          if (local === 't') active.inText = false;
          else if (local === 'p') {
            if (active.currentP.trim()) active.paragraphs.push(active.currentP.trim());
          } else if (local === 'sp') {
            const text = active.paragraphs.join('\n').trim();
            if (text) {
              let bbox: [number, number, number, number] | undefined;
              if (active.x !== undefined && active.y !== undefined && active.cx !== undefined && active.cy !== undefined) {
                const rotated = applyRectRotation({ x: active.x, y: active.y, cx: active.cx, cy: active.cy }, active.rotDeg);
                const mapped = applyGroupTransforms(rotated, groupStack);
                bbox = normalizeBox(mapped.x, mapped.y, mapped.cx, mapped.cy, slideCx, slideCy);
              }
              shapes.push({
                objectId: active.id || `sp-${shapes.length + 1}`,
                name: active.name || `形状#${shapes.length + 1}`,
                text,
                bbox,
                kind: 'shape',
              });
            }
            active = null;
          }
        } else if (active.kind === 'cxn' && local === 'cxnSp') {
          let bbox: [number, number, number, number] | undefined;
          if (active.x !== undefined && active.y !== undefined && active.cx !== undefined && active.cy !== undefined) {
            const rotated = applyRectRotation({ x: active.x, y: active.y, cx: active.cx, cy: active.cy }, active.rotDeg);
            const mapped = applyGroupTransforms(rotated, groupStack);
            bbox = normalizeBox(mapped.x, mapped.y, mapped.cx, mapped.cy, slideCx, slideCy);
          }
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
            bbox,
          });
          active = null;
        }
      },
    });

    // Resolve charts and SmartArt diagrams linked by this slide
    const consumedDiagramTargets = new Set<string>();
    for (const cref of linkedChartRefs) {
      const target = slideRels.get(cref.relId)?.target;
      const chartFile = target ? zip.file(target) : null;
      if (chartFile) {
        const parsedChart = parseChartXml(await chartFile.async('string'), cref.objectId, cref.name, cref.bbox);
        if (parsedChart) shapes.push(parsedChart);
      }
    }
    for (const dref of linkedDiagramRefs) {
      const target = slideRels.get(dref.relId)?.target;
      const diagFile = target ? zip.file(target) : null;
      if (diagFile && target) {
        consumedDiagramTargets.add(target);
        shapes.push(...parseSmartArtTexts(await diagFile.async('string'), `p${i + 1}-diag`, dref.bbox));
      }
    }
    for (const relInfo of slideRels.values()) {
      if (/diagrams\/data\d*\.xml$/i.test(relInfo.target) && !consumedDiagramTargets.has(relInfo.target)) {
        const diagFile = zip.file(relInfo.target);
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
      needsVisualReview:
        shapes.length === 0 ||
        hasSlidePictures ||
        linkedChartRefs.length > 0 ||
        connectors.some(c => !c.fromObjectId || !c.toObjectId),
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

interface XlsxSheetBinding {
  page: number;
  sheetName: string;
  sheetPath: string;
  isChartSheet: boolean;
  shapes: ParsedImportShape[];
  connectors: ParsedImportConnector[];
  images: Array<ParsedEmbeddedImage & { mediaPath: string }>;
}

async function resolveXlsxSheetBindings(zip: JSZip, workbook: StrategyWorkbook): Promise<XlsxSheetBinding[]> {
  const wbFile = zip.file('xl/workbook.xml');
  const wbRels = await parseZipRels(zip, 'xl/workbook.xml');
  const visibleSheets: Array<{ name: string; target: string; isChartSheet: boolean }> = [];

  if (wbFile) {
    parseXmlSafe(await wbFile.async('string'), {
      onOpen(local, attrs) {
        if (local !== 'sheet' || !attrs.name) return;
        const state = attrs.state?.toLowerCase();
        if (state === 'hidden' || state === 'veryhidden') return;
        const rid = attrs['r:id'] ?? Object.entries(attrs).find(([k]) => k.endsWith(':id'))?.[1];
        const rel = rid ? wbRels.get(rid) : undefined;
        if (!rel) return;
        const isChartSheet = rel.type.endsWith('/chartsheet') || /\/chartsheets\//i.test(rel.target);
        visibleSheets.push({ name: attrs.name, target: rel.target, isChartSheet });
      },
    });
  }

  // Fallback if workbook.xml had no resolvable sheet rels
  if (!visibleSheets.length) {
    workbook.sheets.forEach((s, idx) => {
      visibleSheets.push({ name: s.name, target: `xl/worksheets/sheet${idx + 1}.xml`, isChartSheet: false });
    });
  }

  const bindings: XlsxSheetBinding[] = [];
  for (let idx = 0; idx < visibleSheets.length; idx++) {
    const entry = visibleSheets[idx]!;
    const pageNum = idx + 1;
    const sheetShapes: ParsedImportShape[] = [];
    const sheetConnectors: ParsedImportConnector[] = [];
    const sheetImages: Array<ParsedEmbeddedImage & { mediaPath: string }> = [];

    const sheetRels = await parseZipRels(zip, entry.target);
    const drawingTargets: string[] = [];
    const directChartTargets: string[] = [];
    const directDiagramTargets: string[] = [];

    for (const rel of sheetRels.values()) {
      if (rel.type.endsWith('/drawing') || /\/drawings\/drawing\d*\.xml$/i.test(rel.target)) {
        if (!drawingTargets.includes(rel.target)) drawingTargets.push(rel.target);
      } else if (rel.type.endsWith('/chart') || /\/charts\/chart\d*\.xml$/i.test(rel.target)) {
        if (!directChartTargets.includes(rel.target)) directChartTargets.push(rel.target);
      } else if (/\/diagrams\/data\d*\.xml$/i.test(rel.target)) {
        if (!directDiagramTargets.includes(rel.target)) directDiagramTargets.push(rel.target);
      }
    }

    for (const drawingPath of drawingTargets) {
      const drawingFile = zip.file(drawingPath);
      if (!drawingFile) continue;
      const drawingRels = await parseZipRels(zip, drawingPath);

      type RawAnchor = {
        fromCol: number;
        fromRow: number;
        toCol: number;
        toRow: number;
        hasTo: boolean;
        absX?: number;
        absY?: number;
        absCx?: number;
        absCy?: number;
      };
      type PendingObj =
        | { kind: 'shape'; anchor: RawAnchor; shape: Omit<ParsedImportShape, 'bbox'> }
        | { kind: 'connector'; anchor: RawAnchor; connector: Omit<ParsedImportConnector, 'bbox'> }
        | { kind: 'pic'; anchor: RawAnchor; objectId: string; name: string; relId: string }
        | { kind: 'chart'; anchor: RawAnchor; objectId: string; name: string; relId: string }
        | { kind: 'diagram'; anchor: RawAnchor; relId: string };

      const pending: PendingObj[] = [];
      let currentAnchor: RawAnchor | null = null;
      let inFrom = false;
      let inTo = false;
      let coordTag = '';
      let activeSp: { id: string; name: string; paragraphs: string[]; currentP: string; inText: boolean } | null = null;
      let activeCxn: { id: string; name: string; fromId?: string; toId?: string; headArrow: boolean; tailArrow: boolean } | null = null;
      let activePic: { id: string; name: string; relId?: string } | null = null;
      let activeFrame: { id: string; name: string; chartRelId?: string; diagramRelId?: string } | null = null;

      parseXmlSafe(await drawingFile.async('string'), {
        onOpen(local, attrs) {
          if (local === 'twoCellAnchor' || local === 'oneCellAnchor' || local === 'absoluteAnchor') {
            currentAnchor = { fromCol: 0, fromRow: 0, toCol: 4, toRow: 4, hasTo: false };
          } else if (!currentAnchor) {
            return;
          } else if (local === 'from') {
            inFrom = true;
          } else if (local === 'to') {
            inTo = true;
            currentAnchor.hasTo = true;
          } else if (local === 'pos') {
            currentAnchor.absX = Number(attrs.x) || 0;
            currentAnchor.absY = Number(attrs.y) || 0;
          } else if (local === 'ext' && !activeSp && !activeCxn && !activePic && !activeFrame) {
            currentAnchor.absCx = Number(attrs.cx) || 0;
            currentAnchor.absCy = Number(attrs.cy) || 0;
          } else if ((inFrom || inTo) && (local === 'col' || local === 'row')) {
            coordTag = local;
          } else if (local === 'sp') {
            activeSp = { id: '', name: '', paragraphs: [], currentP: '', inText: false };
          } else if (local === 'cxnSp') {
            activeCxn = { id: '', name: '', headArrow: false, tailArrow: false };
          } else if (local === 'pic') {
            activePic = { id: '', name: '' };
          } else if (local === 'graphicFrame') {
            activeFrame = { id: '', name: '' };
          } else if (activeSp) {
            if (local === 'cNvPr' && !activeSp.id) {
              activeSp.id = attrs.id || `p${pageNum}-sp-${pending.length + 1}`;
              activeSp.name = attrs.name || `形状#${pending.length + 1}`;
            } else if (local === 'p') activeSp.currentP = '';
            else if (local === 't') activeSp.inText = true;
            else if (local === 'br') activeSp.currentP += '\n';
          } else if (activeCxn) {
            if (local === 'cNvPr' && !activeCxn.id) {
              activeCxn.id = attrs.id || `p${pageNum}-cxn-${pending.length + 1}`;
              activeCxn.name = attrs.name || `连接符#${pending.length + 1}`;
            } else if (local === 'stCxn' && attrs.id) activeCxn.fromId = attrs.id;
            else if (local === 'endCxn' && attrs.id) activeCxn.toId = attrs.id;
            else if (local === 'headEnd' && attrs.type && attrs.type !== 'none') activeCxn.headArrow = true;
            else if (local === 'tailEnd' && attrs.type && attrs.type !== 'none') activeCxn.tailArrow = true;
          } else if (activePic) {
            if (local === 'cNvPr' && !activePic.id) {
              activePic.id = attrs.id || `p${pageNum}-pic-${pending.length + 1}`;
              activePic.name = attrs.name || `图片#${pending.length + 1}`;
            } else if (local === 'blip') {
              const embed = attrs['r:embed'] ?? attrs.embed;
              if (embed) activePic.relId = embed;
            }
          } else if (activeFrame) {
            if (local === 'cNvPr' && !activeFrame.id) {
              activeFrame.id = attrs.id || `p${pageNum}-frame-${pending.length + 1}`;
              activeFrame.name = attrs.name || `图表#${pending.length + 1}`;
            } else if (local === 'chart') {
              const rid = attrs['r:id'] ?? attrs.id;
              if (rid) activeFrame.chartRelId = rid;
            } else if (local === 'relIds') {
              const dm = attrs['r:dm'] ?? attrs.dm;
              if (dm) activeFrame.diagramRelId = dm;
            }
          }
        },
        onText(s) {
          if (activeSp?.inText) activeSp.currentP += s;
          else if (currentAnchor && inFrom && coordTag === 'col') currentAnchor.fromCol = Number(s) || 0;
          else if (currentAnchor && inFrom && coordTag === 'row') currentAnchor.fromRow = Number(s) || 0;
          else if (currentAnchor && inTo && coordTag === 'col') currentAnchor.toCol = Number(s) || 0;
          else if (currentAnchor && inTo && coordTag === 'row') currentAnchor.toRow = Number(s) || 0;
        },
        onClose(local) {
          if (local === 'from') inFrom = false;
          else if (local === 'to') inTo = false;
          else if (local === 'col' || local === 'row') coordTag = '';
          else if (activeSp) {
            if (local === 't') activeSp.inText = false;
            else if (local === 'p') {
              if (activeSp.currentP.trim()) activeSp.paragraphs.push(activeSp.currentP.trim());
            } else if (local === 'sp') {
              const text = activeSp.paragraphs.join('\n').trim();
              if (text && currentAnchor) {
                pending.push({
                  kind: 'shape',
                  anchor: { ...currentAnchor },
                  shape: {
                    objectId: activeSp.id || `p${pageNum}-sp-${pending.length + 1}`,
                    name: activeSp.name || `形状#${pending.length + 1}`,
                    text,
                    kind: 'shape',
                  },
                });
              }
              activeSp = null;
            }
          } else if (activeCxn && local === 'cxnSp') {
            if (currentAnchor) {
              pending.push({
                kind: 'connector',
                anchor: { ...currentAnchor },
                connector: {
                  objectId: activeCxn.id || `p${pageNum}-cxn-${pending.length + 1}`,
                  name: activeCxn.name,
                  fromObjectId: activeCxn.fromId,
                  toObjectId: activeCxn.toId,
                  arrowDirection:
                    activeCxn.headArrow && activeCxn.tailArrow ? 'both'
                    : activeCxn.tailArrow ? 'forward'
                    : activeCxn.headArrow ? 'backward'
                    : 'none',
                },
              });
            }
            activeCxn = null;
          } else if (activePic && local === 'pic') {
            if (currentAnchor && activePic.relId) {
              pending.push({
                kind: 'pic',
                anchor: { ...currentAnchor },
                objectId: activePic.id || `p${pageNum}-pic-${pending.length + 1}`,
                name: activePic.name || `图片#${pending.length + 1}`,
                relId: activePic.relId,
              });
            }
            activePic = null;
          } else if (activeFrame && local === 'graphicFrame') {
            if (currentAnchor) {
              if (activeFrame.chartRelId) {
                pending.push({
                  kind: 'chart',
                  anchor: { ...currentAnchor },
                  objectId: activeFrame.id || `p${pageNum}-chart-${pending.length + 1}`,
                  name: activeFrame.name || `图表#${pending.length + 1}`,
                  relId: activeFrame.chartRelId,
                });
              } else if (activeFrame.diagramRelId) {
                pending.push({
                  kind: 'diagram',
                  anchor: { ...currentAnchor },
                  relId: activeFrame.diagramRelId,
                });
              }
            }
            activeFrame = null;
          } else if (local === 'twoCellAnchor' || local === 'oneCellAnchor' || local === 'absoluteAnchor') {
            currentAnchor = null;
          }
        },
      });

      // Normalize anchor coordinates consistently across this sheet's drawing canvas
      const maxCol = Math.max(12, ...pending.map(p => (p.anchor.hasTo ? Math.max(p.anchor.fromCol + 1, p.anchor.toCol) : p.anchor.fromCol + 4)));
      const maxRow = Math.max(24, ...pending.map(p => (p.anchor.hasTo ? Math.max(p.anchor.fromRow + 1, p.anchor.toRow) : p.anchor.fromRow + 4)));
      const anchorBox = (a: RawAnchor): [number, number, number, number] => {
        if (a.absX !== undefined && a.absY !== undefined && a.absCx && a.absCy) {
          return normalizeBox(a.absX, a.absY, a.absCx, a.absCy, Math.max(9144000, a.absX + a.absCx), Math.max(6858000, a.absY + a.absCy)) ?? [40, 40, 400, 240];
        }
        const toCol = a.hasTo ? Math.max(a.fromCol + 1, a.toCol) : a.fromCol + 4;
        const toRow = a.hasTo ? Math.max(a.fromRow + 1, a.toRow) : a.fromRow + 4;
        return normalizeBox(a.fromCol, a.fromRow, toCol - a.fromCol, toRow - a.fromRow, maxCol, maxRow) ?? [40, 40, 300, 180];
      };

      const consumedDiagrams = new Set<string>();
      for (const obj of pending) {
        const bbox = anchorBox(obj.anchor);
        if (obj.kind === 'shape') {
          sheetShapes.push({ ...obj.shape, bbox });
        } else if (obj.kind === 'connector') {
          sheetConnectors.push({ ...obj.connector, bbox });
        } else if (obj.kind === 'chart') {
          const target = drawingRels.get(obj.relId)?.target;
          const chartFile = target ? zip.file(target) : null;
          if (chartFile) {
            const parsed = parseChartXml(await chartFile.async('string'), obj.objectId, obj.name, bbox);
            if (parsed) sheetShapes.push(parsed);
          }
        } else if (obj.kind === 'diagram') {
          const target = drawingRels.get(obj.relId)?.target;
          const diagFile = target ? zip.file(target) : null;
          if (diagFile && target) {
            consumedDiagrams.add(target);
            sheetShapes.push(...parseSmartArtTexts(await diagFile.async('string'), `p${pageNum}-diag`, bbox));
          }
        } else if (obj.kind === 'pic') {
          const target = drawingRels.get(obj.relId)?.target;
          const mediaFile = target ? zip.file(target) : null;
          if (mediaFile && target && /\.(png|jpe?g)$/i.test(target)) {
            try {
              const mediaBytes = await mediaFile.async('nodebuffer');
              const meta = inspectImageMetadata(path.posix.basename(target), mediaBytes);
              sheetImages.push({
                id: `p${pageNum}-img-${sheetImages.length + 1}`,
                name: obj.name || path.posix.basename(target),
                mimeType: meta.mimeType,
                width: meta.width,
                height: meta.height,
                orientation: meta.orientation,
                sha256: createHash('sha256').update(mediaBytes).digest('hex'),
                page: pageNum,
                sheetName: entry.name,
                objectId: obj.objectId,
                bbox,
                mediaPath: target,
              });
            } catch {
              // Skip unreadable media entry without failing workbook decode
            }
          }
        }
      }

      // Catch SmartArt linked directly in drawing.rels without explicit relIds tag
      for (const rel of drawingRels.values()) {
        if (/\/diagrams\/data\d*\.xml$/i.test(rel.target) && !consumedDiagrams.has(rel.target)) {
          const diagFile = zip.file(rel.target);
          if (diagFile) sheetShapes.push(...parseSmartArtTexts(await diagFile.async('string'), `p${pageNum}-diag`));
        }
      }
    }

    for (const chartPath of directChartTargets) {
      const chartFile = zip.file(chartPath);
      if (chartFile) {
        const parsed = parseChartXml(await chartFile.async('string'), `p${pageNum}-chart-${sheetShapes.length + 1}`, `图表 · ${entry.name}`, [40, 40, 920, 880]);
        if (parsed) sheetShapes.push(parsed);
      }
    }
    for (const diagPath of directDiagramTargets) {
      const diagFile = zip.file(diagPath);
      if (diagFile) sheetShapes.push(...parseSmartArtTexts(await diagFile.async('string'), `p${pageNum}-diag`));
    }

    bindings.push({
      page: pageNum,
      sheetName: entry.name,
      sheetPath: entry.target,
      isChartSheet: entry.isChartSheet,
      shapes: sheetShapes,
      connectors: sheetConnectors,
      images: sheetImages,
    });
  }

  return bindings;
}

async function parseXlsxImport(fileName: string, bytes: Buffer): Promise<DecodedStrategyMapImport> {
  const workbook = await decodeStrategyWorkbook(fileName, bytes);
  const zip = await JSZip.loadAsync(bytes);
  const bindings = await resolveXlsxSheetBindings(zip, workbook);

  const allEmbeddedImages: ParsedEmbeddedImage[] = [];
  const pages: ParsedImportPage[] = bindings.map(binding => {
    const sheet = workbook.sheets.find(s => s.name === binding.sheetName);
    const cellText = sheet
      ? sheet.rows.map(r => `第 ${r.row} 行: ${Object.entries(r.values).map(([c, v]) => `${c}=${v}`).join(' | ')}`).join('\n')
      : '';
    const shapeText = binding.shapes.map(s => `[${s.name}] ${s.text}`).join('\n');
    const imageNoteText = binding.images.length
      ? binding.images.map((img, i) => `[嵌入图 ${i + 1}: ${img.name} (${img.width}×${img.height})]`).join('\n')
      : '';
    const combinedText = [cellText, shapeText, imageNoteText].filter(Boolean).join('\n');

    const publicImages: ParsedEmbeddedImage[] = binding.images.map(({ mediaPath: _mp, ...rest }) => rest);
    allEmbeddedImages.push(...publicImages);

    const hasSheetDrawings = binding.shapes.length > 0 || binding.connectors.length > 0 || publicImages.length > 0 || binding.isChartSheet;
    const notes: string[] = [];
    if (publicImages.length > 1) {
      notes.push(`本工作表包含 ${publicImages.length} 幅嵌入图片，可逐幅切换核对。`);
    }
    if (binding.shapes.some(s => s.kind === 'chart')) {
      notes.push('本工作表包含图表对象，已提取图表标题与标签。');
    }

    return {
      page: binding.page,
      title: `工作表 · ${binding.sheetName}`,
      sheetName: binding.sheetName,
      text: combinedText,
      hasTextLayer: combinedText.trim().length > 0,
      needsVisualReview: hasSheetDrawings,
      shapes: binding.shapes,
      connectors: binding.connectors,
      ...(publicImages.length ? { embeddedImages: publicImages } : {}),
      ...(notes.length ? { notes } : {}),
    };
  });

  return {
    format: 'xlsx',
    fileName,
    sha256: workbook.sha256,
    bytesLength: bytes.byteLength,
    pages,
    workbook,
    embeddedImages: allEmbeddedImages,
    hasDrawings: Boolean(workbook.drawings || bindings.some(b => b.shapes.length || b.connectors.length || b.images.length || b.isChartSheet)),
  };
}

async function parsePdfImport(fileName: string, bytes: Buffer): Promise<DecodedStrategyMapImport> {
  if (!bytes.length || bytes.length > STRATEGY_MAP_IMPORT_MAX_BYTES) {
    return fault('strategy_map_import_too_large', 413);
  }
  const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
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

  const imageOps = new Set<number>([
    OPS.paintImageXObject,
    OPS.paintInlineImageXObject,
    OPS.paintImageMaskXObject,
    OPS.paintImageXObjectRepeat,
  ].filter(v => typeof v === 'number'));
  const vectorOps = new Set<number>([
    OPS.stroke,
    OPS.closeStroke,
    OPS.fill,
    OPS.eoFill,
    OPS.fillStroke,
    OPS.eoFillStroke,
    OPS.closeFillStroke,
    OPS.closeEOFillStroke,
    OPS.constructPath,
  ].filter(v => typeof v === 'number'));

  const pages: ParsedImportPage[] = [];
  try {
    const pdf = await loading.promise;
    if (pdf.numPages < 1 || pdf.numPages > 200) return fault('strategy_map_import_page_limit', 413);
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const [va, vb, vc, vd, ve, vf] = viewport.transform;
      const content = await page.getTextContent();
      const shapes: ParsedImportShape[] = [];
      const pieces: string[] = [];

      for (const item of content.items) {
        if (!('str' in item)) continue;
        const s = item.str.trim();
        pieces.push(item.str + (item.hasEOL ? '\n' : ' '));
        if (s && Array.isArray(item.transform) && item.transform.length >= 6 && viewport.width > 0 && viewport.height > 0) {
          const [ta, tb, tc, td, tx, ty] = item.transform as number[];
          const baseLen = Math.hypot(ta!, tb!) || 1;
          const ux = ta! / baseLen;
          const uy = tb! / baseLen;
          const ascLen = Math.hypot(tc!, td!);
          const vx = ascLen > 0 ? tc! / ascLen : -uy;
          const vy = ascLen > 0 ? td! / ascLen : ux;
          const fontH = item.height > 0 ? item.height : (ascLen || baseLen || 12);
          const textW = item.width > 0 ? item.width : Math.max(fontH * 0.6, s.length * fontH * 0.5);

          // Map all 4 PDF user-space corners through viewport.transform (handles /Rotate 0/90/180/270 & CropBox)
          const corners: Array<[number, number]> = [
            [tx!, ty!],
            [tx! + ux * textW, ty! + uy * textW],
            [tx! + ux * textW + vx * fontH, ty! + uy * textW + vy * fontH],
            [tx! + vx * fontH, ty! + vy * fontH],
          ];
          const mappedX: number[] = [];
          const mappedY: number[] = [];
          for (const [px, py] of corners) {
            mappedX.push(va! * px + vc! * py + ve!);
            mappedY.push(vb! * px + vd! * py + vf!);
          }
          const minX = Math.min(...mappedX);
          const maxX = Math.max(...mappedX);
          const minY = Math.min(...mappedY);
          const maxY = Math.max(...mappedY);
          const box = normalizeBox(minX, minY, Math.max(1, maxX - minX), Math.max(1, maxY - minY), viewport.width, viewport.height);
          if (box && shapes.length < 120) {
            shapes.push({
              objectId: `p${i}-t${shapes.length + 1}`,
              name: `第 ${i} 页文本#${shapes.length + 1}`,
              text: s,
              bbox: box,
              kind: 'shape',
            });
          }
        }
      }

      // Inspect operator list so mixed PDFs (long title text + embedded image or vector diagram) trigger visual review
      let imageOpCount = 0;
      let vectorOpCount = 0;
      try {
        const opList = await page.getOperatorList();
        for (const fnId of opList.fnArray) {
          if (imageOps.has(fnId)) imageOpCount++;
          else if (vectorOps.has(fnId)) vectorOpCount++;
        }
      } catch {
        // If operator list inspection fails, stay conservative
        imageOpCount = 1;
      }

      const text = pieces.join('').trim();
      const hasTextLayer = text.length > 0;
      const hasGraphics = imageOpCount > 0 || vectorOpCount >= 2;
      const needsVisualReview = !hasTextLayer || text.length < 20 || hasGraphics;
      const notes: string[] = [];
      if (!hasTextLayer) {
        notes.push('本页无可读文字层（扫描页或纯图），建议视觉模型读取或对照原稿核对。');
      } else if (hasGraphics) {
        notes.push('本页同时包含文字层与嵌入图/矢量图形，可能存在图内独有指标或连线，建议由视觉模型读取整页图或对照原稿核对。');
      }

      pages.push({
        page: i,
        title: hasTextLayer ? `第 ${i} 页 · ${text.split('\n')[0]!.slice(0, 40)}` : `第 ${i} 页 · 扫描/纯图页`,
        text,
        hasTextLayer,
        needsVisualReview,
        shapes,
        connectors: [],
        ...(notes.length ? { notes } : {}),
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

async function renderOfficeSheetViaLibreOffice(
  bytes: Buffer,
  ext: string,
  expectedPages: number,
  page: number,
  thumbnail: boolean,
): Promise<RenderedPageImageResult | null> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'optracall-office-render-'));
  try {
    const srcPath = path.join(tmpDir, `book${ext}`);
    const outDir = path.join(tmpDir, 'pdf');
    const profileDir = path.join(tmpDir, 'lo-profile');
    await writeFile(srcPath, bytes, { mode: 0o600 });
    const sofficeCandidates = [
      process.env.SOFFICE,
      '/Applications/LibreOffice.app/Contents/MacOS/soffice',
      'soffice',
    ].filter((x): x is string => Boolean(x));
    let convertedPdf = '';
    for (const bin of sofficeCandidates) {
      try {
        await execFileAsync(
          bin,
          [`-env:UserInstallation=file://${profileDir}`, '--headless', '--convert-to', 'pdf', '--outdir', outDir, srcPath],
          { timeout: 90_000 },
        );
        convertedPdf = path.join(outDir, 'book.pdf');
        break;
      } catch {
        continue;
      }
    }
    if (!convertedPdf) return null;
    const outPng = path.join(tmpDir, 'sheet.png');
    const targetWidth = thumbnail ? 320 : 1280;
    try {
      await execFileAsync(
        'python3',
        [
          '-c',
          'import sys, pypdfium2 as p; doc=p.PdfDocument(sys.argv[1]); exp=int(sys.argv[2]); pg_idx=int(sys.argv[3])-1; w_target=int(sys.argv[4]); assert len(doc)==exp and 0<=pg_idx<len(doc); pg=doc[pg_idx]; w,h=pg.get_size(); pg.render(scale=min(2.0,w_target/max(1,w))).to_pil().save(sys.argv[5])',
          convertedPdf,
          String(expectedPages),
          String(page),
          String(targetWidth),
          outPng,
        ],
        { timeout: 60_000 },
      );
      const pngBytes = await readFile(outPng);
      const meta = inspectImageMetadata('sheet.png', pngBytes);
      return {
        available: true,
        mimeType: 'image/png',
        base64: pngBytes.toString('base64'),
        width: meta.width,
        height: meta.height,
        orientation: 1,
        renderer: 'libreoffice+pypdfium2',
      };
    } catch {
      return null;
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * On-demand page image rendering.
 * Reuses extensions/analysis-assets/ppt-report/scripts/page_images.py for PPTX,
 * native bytes for PNG/JPEG, strict sheet-scoped embedded media (or LibreOffice chart render) for XLSX,
 * and pdftoppm/pypdfium2 for PDF.
 * Cleanly reports unavailable renderer instead of throwing or misattributing another page's image.
 */
export async function renderImportPageImage(options: {
  fileName: string;
  format: StrategyMapImportFormat;
  bytes: Buffer;
  page: number;
  codeRoot: string;
  thumbnail?: boolean;
  imageIndex?: number;
  includeAllSheetImages?: boolean;
}): Promise<RenderedPageImageResult> {
  const { fileName, format, bytes, page, codeRoot, thumbnail = false, imageIndex, includeAllSheetImages = false } = options;
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
    const workbook = await decodeStrategyWorkbook(fileName, bytes);
    const zip = await JSZip.loadAsync(bytes);
    const bindings = await resolveXlsxSheetBindings(zip, workbook);
    const binding = bindings[page - 1];
    if (!binding) {
      return { available: false, reason: `未找到第 ${page} 个工作表。` };
    }
    const sheetImages = binding.images;
    if (imageIndex !== undefined) {
      if (!Number.isInteger(imageIndex) || imageIndex < 1 || imageIndex > sheetImages.length) {
        return {
          available: false,
          reason: `工作表「${binding.sheetName}」不存在第 ${imageIndex} 幅嵌入图片（共 ${sheetImages.length} 幅）。`,
          totalSheetImages: sheetImages.length,
        };
      }
      const chosen = sheetImages[imageIndex - 1]!;
      const imgBytes = await zip.file(chosen.mediaPath)!.async('nodebuffer');
      return {
        available: true,
        mimeType: chosen.mimeType,
        base64: imgBytes.toString('base64'),
        width: chosen.width,
        height: chosen.height,
        orientation: chosen.orientation,
        renderer: 'xlsx-sheet-embedded-media',
        imageId: chosen.id,
        imageName: chosen.name,
        imageIndex,
        totalSheetImages: sheetImages.length,
      };
    }

    if (sheetImages.length > 0) {
      const first = sheetImages[0]!;
      const firstBytes = await zip.file(first.mediaPath)!.async('nodebuffer');
      const extraImages: NonNullable<RenderedPageImageResult['extraImages']> = [];
      if (includeAllSheetImages && sheetImages.length > 1) {
        for (const extra of sheetImages.slice(1)) {
          const extraBytes = await zip.file(extra.mediaPath)!.async('nodebuffer');
          extraImages.push({
            imageId: extra.id,
            imageName: extra.name,
            mimeType: extra.mimeType,
            base64: extraBytes.toString('base64'),
            width: extra.width,
            height: extra.height,
            orientation: extra.orientation,
          });
        }
      }
      return {
        available: true,
        mimeType: first.mimeType,
        base64: firstBytes.toString('base64'),
        width: first.width,
        height: first.height,
        orientation: first.orientation,
        renderer: 'xlsx-sheet-embedded-media',
        imageId: first.id,
        imageName: first.name,
        imageIndex: 1,
        totalSheetImages: sheetImages.length,
        ...(extraImages.length ? { extraImages } : {}),
      };
    }

    // Sheet has charts/shapes/SmartArt without embedded PNG/JPG: try LibreOffice render when available
    if (binding.shapes.length > 0 || binding.connectors.length > 0 || binding.isChartSheet) {
      const rendered = await renderOfficeSheetViaLibreOffice(bytes, '.xlsx', bindings.length, page, thumbnail);
      if (rendered) return rendered;
      return {
        available: false,
        reason: `工作表「${binding.sheetName}」含图表或原生绘图，本机未检测到 LibreOffice/pypdfium2 整页图渲染环境；已提取原生图表标题、形状与表格结构供核对。`,
        totalSheetImages: 0,
      };
    }

    return {
      available: false,
      reason: `工作表「${binding.sheetName}」为纯单元格表，无嵌入图片或绘图对象；请直接核对单元格内容。`,
      totalSheetImages: 0,
    };
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'optracall-import-render-'));
  try {
    if (format === 'pptx') {
      const script = path.join(codeRoot, 'extensions/analysis-assets/ppt-report/scripts/page_images.py');
      const deckPath = path.join(tmpDir, 'deck.pptx');
      const outDir = path.join(tmpDir, 'out');
      await writeFile(deckPath, bytes, { mode: 0o600 });
      try {
        await execFileAsync('python3', [script, '--deck', deckPath, '--out', outDir, '--width', '1280', '--thumb-width', '320'], { timeout: 90_000 });
      } catch (err) {
        const stderr = err && typeof err === 'object' && 'stderr' in err ? String((err as { stderr?: unknown }).stderr ?? '') : '';
        return {
          available: false,
          reason: stderr.includes('soffice') || stderr.includes('pypdfium2')
            ? '本机未检测到 LibreOffice 或 pypdfium2 渲染环境，已使用原生幻灯片形状/文字/连接符；可结合原稿手工核对。'
            : 'PPT 整页渲染暂不可用，已回退原生形状/文字/连接符供核对。',
        };
      }
      const prefix = thumbnail ? 'thumb' : 'slide';
      const imgPath = path.join(outDir, `${prefix}-${String(page).padStart(2, '0')}.png`);
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
      const dpi = thumbnail ? '56' : '144';
      try {
        await execFileAsync('pdftoppm', ['-png', '-r', dpi, '-f', String(page), '-l', String(page), '-singlefile', pdfPath, outPrefix], { timeout: 60_000 });
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
        try {
          const outPng = `${outPrefix}.png`;
          const targetW = thumbnail ? '320' : '1280';
          await execFileAsync('python3', [
            '-c',
            'import sys, pypdfium2 as p; doc=p.PdfDocument(sys.argv[1]); pg=doc[int(sys.argv[2])-1]; w,h=pg.get_size(); pg.render(scale=min(2.0,int(sys.argv[3])/max(1,w))).to_pil().save(sys.argv[4])',
            pdfPath,
            String(page),
            targetW,
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
