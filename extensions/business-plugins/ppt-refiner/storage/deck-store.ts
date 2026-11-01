import { closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DeckFault, type DeckMeta, type DiffEntry, type VersionEntry } from '../types.ts';

const fail = (code: string): never => { throw new DeckFault(code); };
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isoDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const pageNumber = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 999;

function decodeMeta(value: unknown): DeckMeta {
  if (!object(value) || typeof value.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(value.id)
    || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200
    || typeof value.sourceReport !== 'string' || !value.sourceReport.trim()
    || !Array.isArray(value.lockedPages) || !value.lockedPages.every(pageNumber)
    || !isoDate(value.createdAt) || !isoDate(value.updatedAt)) return fail('DECK_CORRUPT');
  return { id: value.id as string, title: value.title as string, sourceReport: value.sourceReport as string, lockedPages: value.lockedPages as number[], createdAt: value.createdAt as string, updatedAt: value.updatedAt as string };
}

function decodeVersion(value: unknown): VersionEntry {
  if (!object(value) || !Number.isSafeInteger(value.version) || (value.version as number) < 1 || !isoDate(value.at)
    || !Array.isArray(value.pages) || !value.pages.every(pageNumber) || typeof value.summary !== 'string'
    || !Array.isArray(value.diffs) || !value.diffs.every(d => object(d) && pageNumber(d.page)
      && ['wording', 'number', 'layout', 'regenerate'].includes(String(d.kind))
      && typeof d.summary === 'string' && ['covered', 'uncovered-confirmed', 'none'].includes(String(d.anchor)))) return fail('DECK_CORRUPT');
  return value as unknown as VersionEntry;
}

function writeAtomic(file: string, data: string | Buffer) {
  const tmp = `${file}.tmp-${randomUUID()}`;
  const fd = openSync(tmp, 'wx', 0o600);
  try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, file);
  const dir = openSync(path.dirname(file), 'r');
  try { fsyncSync(dir); } finally { closeSync(dir); }
}

function copyAtomic(source: string, target: string) {
  const tmp = `${target}.tmp-${randomUUID()}`;
  copyFileSync(source, tmp);
  renameSync(tmp, target);
}

export function createDeckStore(deckDir: string) {
  const root = path.resolve(deckDir);
  const versionsDir = path.join(root, 'versions');
  const metaPath = path.join(root, 'meta.json');
  const deckPath = path.join(root, 'deck.pptx');

  const ensureRoot = () => {
    mkdirSync(versionsDir, { recursive: true, mode: 0o700 });
    for (const dir of [root, versionsDir]) {
      const stat = lstatSync(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('DECK_UNSAFE_ROOT');
    }
  };
  const readMeta = (): DeckMeta => {
    if (!existsSync(metaPath)) return fail('DECK_NOT_FOUND');
    try { return decodeMeta(JSON.parse(readFileSync(metaPath, 'utf-8'))); } catch (error) {
      if (error instanceof DeckFault) throw error;
      return fail('DECK_CORRUPT');
    }
  };
  const writeMeta = (meta: DeckMeta) => writeAtomic(metaPath, JSON.stringify(meta, null, 2));
  const versionFile = (n: number) => path.join(versionsDir, `v${n}.pptx`);
  const versionMetaFile = (n: number) => path.join(versionsDir, `v${n}.json`);
  const readVersion = (n: number): VersionEntry => {
    try { return decodeVersion(JSON.parse(readFileSync(versionMetaFile(n), 'utf-8'))); } catch (error) {
      if (error instanceof DeckFault) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fail('VERSION_NOT_FOUND');
      return fail('DECK_CORRUPT');
    }
  };
  const listVersions = (): VersionEntry[] => {
    if (!existsSync(versionsDir)) return [];
    return readdirSync(versionsDir).filter(n => /^v\d+\.json$/.test(n)).map(n => readVersion(Number(n.slice(1, -5)))).sort((a, b) => a.version - b.version);
  };
  const snapshot = (input: { pages: readonly number[]; summary: string; diffs?: readonly DiffEntry[] }): VersionEntry => {
    ensureRoot();
    if (!existsSync(deckPath)) fail('DECK_NOT_FOUND');
    const next = listVersions().reduce((max, v) => Math.max(max, v.version), 0) + 1;
    const entry: VersionEntry = { version: next, at: new Date().toISOString(), pages: input.pages, summary: input.summary, diffs: input.diffs ?? [] };
    if (entry.pages.some(p => !pageNumber(p))) fail('DECK_INVALID_PAGE');
    if (entry.summary.length > 500) fail('DECK_INVALID_INPUT');
    copyAtomic(deckPath, versionFile(next));
    writeAtomic(versionMetaFile(next), JSON.stringify(entry, null, 2));
    return entry;
  };

  return {
    deckPath,
    register(input: { sourcePptx: string; title: string; reportPath: string }): DeckMeta {
      ensureRoot();
      if (existsSync(metaPath)) fail('DECK_EXISTS');
      const stat = lstatSync(input.sourcePptx);
      if (!stat.isFile() || stat.size === 0 || !/\.pptx$/i.test(input.sourcePptx)) fail('DECK_INVALID_SOURCE');
      if (!input.title.trim() || input.title.length > 200) fail('DECK_INVALID_INPUT');
      copyFileSync(input.sourcePptx, deckPath);
      const now = new Date().toISOString();
      const meta: DeckMeta = { id: path.basename(root).toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'deck', title: input.title, sourceReport: path.resolve(input.reportPath), lockedPages: [], createdAt: now, updatedAt: now };
      writeMeta(meta);
      snapshot({ pages: [], summary: '初始候选版' });
      return meta;
    },
    meta: readMeta,
    snapshot,
    versions: listVersions,
    assertEditable(page: number) {
      if (!pageNumber(page)) fail('DECK_INVALID_PAGE');
      if (readMeta().lockedPages.includes(page)) fail('PAGE_LOCKED');
    },
    setPageLocked(page: number, locked: boolean): DeckMeta {
      if (!pageNumber(page)) fail('DECK_INVALID_PAGE');
      const meta = readMeta();
      const pages = new Set(meta.lockedPages);
      if (locked) pages.add(page); else pages.delete(page);
      const next: DeckMeta = { ...meta, lockedPages: [...pages].sort((a, b) => a - b), updatedAt: new Date().toISOString() };
      writeMeta(next);
      return next;
    },
    revert(version: number): VersionEntry {
      const target = readVersion(version);
      for (const entry of listVersions()) {
        if (entry.version > version && !entry.undone) writeAtomic(versionMetaFile(entry.version), JSON.stringify({ ...entry, undone: true }, null, 2));
      }
      snapshot({ pages: [], summary: `回退 v${version} 前状态` });
      copyAtomic(versionFile(version), deckPath);
      const meta = readMeta();
      writeMeta({ ...meta, updatedAt: new Date().toISOString() });
      return target;
    },
    exportFinal(input: { outDir: string; fileName?: string }) {
      ensureRoot();
      const meta = readMeta();
      mkdirSync(input.outDir, { recursive: true, mode: 0o700 });
      const name = input.fileName && /^[\w一-龥.-]+\.pptx$/.test(input.fileName) ? input.fileName : 'final.pptx';
      const pptxOut = path.join(input.outDir, name);
      copyAtomic(deckPath, pptxOut);
      const versions = listVersions();
      const lines = ['# 与 md 报告的差异清单', '', `deck: ${meta.title}`, `锚点报告: ${meta.sourceReport}`, `导出时间: ${new Date().toISOString()}`, ''];
      const entries = versions.filter(v => !v.undone).flatMap(v => v.diffs.map(d => ({ version: v.version, ...d })));
      if (!entries.length) lines.push('（无内容级改动差异）');
      for (const d of entries) lines.push(`- v${d.version} · P${d.page} · ${d.kind} · ${d.summary} · 锚点: ${d.anchor}`);
      lines.push('', '差异仅标记，不回写 md 报告；回填请在报告侧另行修订。');
      const diffOut = path.join(input.outDir, name.replace(/\.pptx$/, '.diff.md'));
      writeAtomic(diffOut, lines.join('\n'));
      return { pptx: pptxOut, diff: diffOut, versionCount: versions.length };
    },
  };
}
