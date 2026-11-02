import { closeSync, constants, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
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
  if (value.configuration !== undefined && (!object(value.configuration) || typeof value.configuration.id !== 'string' || (value.configuration.revision !== undefined && !Number.isSafeInteger(value.configuration.revision)))) return fail('DECK_CORRUPT');
  if (value.currentVersion !== undefined && (!Number.isSafeInteger(value.currentVersion) || (value.currentVersion as number) < 1)) return fail('DECK_CORRUPT');
  return { id: value.id as string, title: value.title as string, sourceReport: value.sourceReport as string, lockedPages: value.lockedPages as number[], createdAt: value.createdAt as string, updatedAt: value.updatedAt as string, ...(object(value.configuration) ? { configuration: value.configuration as { id: string; revision?: number } } : {}), ...(value.currentVersion === undefined ? {} : { currentVersion: value.currentVersion as number }) };
}

function decodeVersion(value: unknown): VersionEntry {
  if (!object(value) || !Number.isSafeInteger(value.version) || (value.version as number) < 1 || !isoDate(value.at)
    || !Array.isArray(value.pages) || !value.pages.every(pageNumber) || typeof value.summary !== 'string'
    || !Array.isArray(value.diffs) || !value.diffs.every(d => object(d) && pageNumber(d.page)
      && ['wording', 'number', 'layout', 'regenerate'].includes(String(d.kind))
      && typeof d.summary === 'string' && ['covered', 'uncovered-confirmed', 'none'].includes(String(d.anchor)))) return fail('DECK_CORRUPT');
  if (value.undone !== undefined && typeof value.undone !== 'boolean') return fail('DECK_CORRUPT');
  if (value.diffsKnown !== undefined && typeof value.diffsKnown !== 'boolean') return fail('DECK_CORRUPT');
  if (value.parentVersion !== undefined && value.parentVersion !== null && (!Number.isSafeInteger(value.parentVersion) || (value.parentVersion as number) < 1 || (value.parentVersion as number) >= (value.version as number))) return fail('DECK_CORRUPT');
  return value as unknown as VersionEntry;
}

function writeAtomic(file: string, data: string | Buffer, exclusive = false) {
  const tmp = `${file}.tmp-${randomUUID()}`;
  const fd = openSync(tmp, 'wx', 0o600);
  try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
  if (exclusive) { linkSync(tmp, file); unlinkSync(tmp); }
  else renameSync(tmp, file);
  const dir = openSync(path.dirname(file), 'r');
  try { fsyncSync(dir); } finally { closeSync(dir); }
}

function copyAtomic(source: string, target: string) {
  const tmp = `${target}.tmp-${randomUUID()}`;
  copyFileSync(source, tmp);
  renameSync(tmp, target);
}

function assertUnoccupied(file: string) {
  try { lstatSync(file); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  fail('EXPORT_EXISTS');
}

/** Complete files are published without replacing an existing file or link. */
function publishExport(pptxOut: string, pptx: Buffer, diffOut: string, diff: string) {
  for (const file of [pptxOut, diffOut]) assertUnoccupied(file);
  const nonce = randomUUID();
  const stages = [`${pptxOut}.export-${nonce}`, `${diffOut}.export-${nonce}`];
  let published = 0;
  try {
    for (const [index, data] of [pptx, diff].entries()) {
      const fd = openSync(stages[index]!, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
    }
    linkSync(stages[0]!, pptxOut); published++;
    linkSync(stages[1]!, diffOut); published++;
    const directory = openSync(path.dirname(pptxOut), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } catch (error) {
    // Retain staging evidence and any publication whose outcome is known;
    // a later attempt must not erase this failure or overwrite its output.
    if (!published && (error as NodeJS.ErrnoException).code === 'EEXIST') fail('EXPORT_EXISTS');
    fail('EXPORT_INCOMPLETE');
  }
  for (const stage of stages) unlinkSync(stage);
}

export function createDeckStore(deckDir: string) {
  const root = path.resolve(deckDir);
  const versionsDir = path.join(root, 'versions');
  const metaPath = path.join(root, 'meta.json');
  const deckPath = path.join(root, 'deck.pptx');

  const ensureRoot = () => {
    for (const dir of [root, versionsDir]) {
      try { mkdirSync(dir, { recursive: dir === root, mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const stat = lstatSync(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('DECK_UNSAFE_ROOT');
    }
  };
  const assertRegistrationVacant = (ownDeck = false) => {
    let stat;
    try { stat = lstatSync(root); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('DECK_UNSAFE_ROOT');
    const entries = readdirSync(root);
    if (entries.some(entry => entry !== 'versions' && !(ownDeck && entry === 'deck.pptx'))) fail('DECK_EXISTS');
    if (entries.includes('versions')) {
      const versions = lstatSync(versionsDir);
      if (!versions.isDirectory() || versions.isSymbolicLink()) fail('DECK_UNSAFE_ROOT');
      if (readdirSync(versionsDir).length) fail('DECK_EXISTS');
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
    try {
      const entry = decodeVersion(JSON.parse(readFileSync(versionMetaFile(n), 'utf-8')));
      if (entry.version !== n) fail('DECK_CORRUPT');
      return entry;
    } catch (error) {
      if (error instanceof DeckFault) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fail('VERSION_NOT_FOUND');
      return fail('DECK_CORRUPT');
    }
  };
  const listVersions = (): VersionEntry[] => {
    if (!existsSync(versionsDir)) return [];
    return readdirSync(versionsDir).filter(n => /^v\d+\.json$/.test(n)).map(n => readVersion(Number(n.slice(1, -5)))).sort((a, b) => a.version - b.version);
  };
  const snapshot = (input: { pages: readonly number[]; summary: string; diffs?: readonly DiffEntry[]; beforeSha256?: string; diffsKnown?: boolean }): VersionEntry => {
    ensureRoot();
    if (!existsSync(deckPath)) fail('DECK_NOT_FOUND');
    const meta = readMeta();
    const next = listVersions().reduce((max, v) => Math.max(max, v.version), 0) + 1;
    let parentVersion: number | null | undefined = next === 1 ? null : meta.currentVersion;
    if (input.beforeSha256 !== undefined && !/^[a-f0-9]{64}$/.test(input.beforeSha256)) fail('DECK_INVALID_INPUT');
    if (input.diffsKnown !== undefined && typeof input.diffsKnown !== 'boolean') fail('DECK_INVALID_INPUT');
    if (typeof parentVersion === 'number') {
      readVersion(parentVersion);
      if (input.beforeSha256 && createHash('sha256').update(readFileSync(versionFile(parentVersion))).digest('hex') !== input.beforeSha256) parentVersion = undefined;
    }
    const entry: VersionEntry = { version: next, at: new Date().toISOString(), pages: input.pages, summary: input.summary, diffs: input.diffs ?? [], ...(parentVersion === undefined ? {} : { parentVersion }), ...(input.diffsKnown === undefined ? {} : { diffsKnown: input.diffsKnown }) };
    if (entry.pages.some(p => !pageNumber(p))) fail('DECK_INVALID_PAGE');
    if (entry.summary.length > 500) fail('DECK_INVALID_INPUT');
    copyAtomic(deckPath, versionFile(next));
    writeAtomic(versionMetaFile(next), JSON.stringify(entry, null, 2));
    writeMeta({ ...meta, currentVersion: next, updatedAt: entry.at });
    return entry;
  };

  return {
    deckPath,
    register(input: { sourcePptx: string; title: string; reportPath: string; configuration?: { id: string; revision?: number } }): DeckMeta {
      const stat = lstatSync(input.sourcePptx);
      if (!stat.isFile() || stat.size === 0 || !/\.pptx$/i.test(input.sourcePptx)) fail('DECK_INVALID_SOURCE');
      if (!input.title.trim() || input.title.length > 200) fail('DECK_INVALID_INPUT');
      // An incomplete directory is evidence, not a retry target. Check before
      // mkdir/copy so rejected registrations do not alter an existing scene.
      assertRegistrationVacant();
      ensureRoot();
      assertRegistrationVacant();
      try {
        copyFileSync(input.sourcePptx, deckPath, constants.COPYFILE_EXCL);
        assertRegistrationVacant(true);
        const now = new Date().toISOString();
        const meta: DeckMeta = { id: path.basename(root).toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'deck', title: input.title, sourceReport: path.resolve(input.reportPath), lockedPages: [], createdAt: now, updatedAt: now, currentVersion: 1, ...(input.configuration ? { configuration: input.configuration } : {}) };
        const initial: VersionEntry = { version: 1, at: now, pages: [], summary: '初始候选版', diffs: [], parentVersion: null };
        copyFileSync(deckPath, versionFile(1), constants.COPYFILE_EXCL);
        writeAtomic(versionMetaFile(1), JSON.stringify(initial, null, 2), true);
        if (readdirSync(root).some(entry => entry !== 'deck.pptx' && entry !== 'versions') || readdirSync(versionsDir).some(entry => !['v1.pptx', 'v1.json'].includes(entry))) fail('DECK_EXISTS');
        // Publish the registration marker last and without replacing a
        // concurrently created file. Failures remain untouched for review.
        writeAtomic(metaPath, JSON.stringify(meta, null, 2), true);
        return readMeta();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('DECK_EXISTS');
        throw error;
      }
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
      snapshot({ pages: [], summary: `回退 v${version} 前状态`, beforeSha256: createHash('sha256').update(readFileSync(deckPath)).digest('hex') });
      for (const entry of listVersions()) {
        if (entry.version > version && !entry.undone) writeAtomic(versionMetaFile(entry.version), JSON.stringify({ ...entry, undone: true }, null, 2));
        if (entry.version === version && entry.undone) writeAtomic(versionMetaFile(entry.version), JSON.stringify({ ...entry, undone: false }, null, 2));
      }
      copyAtomic(versionFile(version), deckPath);
      const meta = readMeta();
      writeMeta({ ...meta, currentVersion: version, updatedAt: new Date().toISOString() });
      return target;
    },
    exportFinal(input: { outDir: string; fileName?: string }) {
      ensureRoot();
      const meta = readMeta();
      mkdirSync(input.outDir, { recursive: true, mode: 0o700 });
      const name = input.fileName && /^[\w一-龥.-]+\.pptx$/.test(input.fileName) ? input.fileName : 'final.pptx';
      const pptxOut = path.join(input.outDir, name);
      const versions = listVersions();
      const active: VersionEntry[] = [];
      let diffHistoryKnown = meta.currentVersion !== undefined;
      let cursor: number | null | undefined = meta.currentVersion;
      while (typeof cursor === 'number') {
        const entry = readVersion(cursor);
        active.push(entry);
        if (entry.diffsKnown === false) diffHistoryKnown = false;
        cursor = entry.parentVersion;
        if (cursor === undefined) diffHistoryKnown = false;
      }
      if (meta.currentVersion !== undefined && !readFileSync(deckPath).equals(readFileSync(versionFile(meta.currentVersion)))) diffHistoryKnown = false;
      active.reverse();
      const lines = ['# 与 md 报告的差异清单', '', `deck: ${meta.title}`, `锚点报告: ${meta.sourceReport}`, `导出时间: ${new Date().toISOString()}`, ''];
      const entries = active.flatMap(v => v.diffs.map(d => ({ version: v.version, ...d })));
      const unknownDiffVersions = active.filter(entry => entry.diffsKnown === false).map(entry => `v${entry.version}`);
      if (unknownDiffVersions.length) lines.push(`${unknownDiffVersions.join('、')} 的本轮内容差异未核定：缺少有效机器记录，不代表没有内容改动。`, '');
      if (!diffHistoryKnown) lines.push('历史差异谱系未核定，或当前 PPTX 含未记录的外部编辑；以下记录不能证明差异完整，也不能据此认定与 md 一致。', '');
      if (!entries.length && diffHistoryKnown) lines.push('（无内容级改动差异）');
      for (const d of entries) lines.push(`- v${d.version} · P${d.page} · ${d.kind} · ${d.summary} · 锚点: ${d.anchor}`);
      if (!diffHistoryKnown) {
        const activeVersions = new Set(active.map(entry => entry.version));
        const uncertain = versions.filter(entry => !activeVersions.has(entry.version)).flatMap(entry => entry.diffs.map(diff => ({ version: entry.version, ...diff })));
        if (uncertain.length) lines.push('', '## 历史记录（采用状态未知）', ...uncertain.map(diff => `- v${diff.version} · P${diff.page} · ${diff.kind} · ${diff.summary} · 锚点: ${diff.anchor}`));
      }
      lines.push('', '差异仅标记，不回写 md 报告；回填请在报告侧另行修订。');
      const diffOut = path.join(input.outDir, name.replace(/\.pptx$/, '.diff.md'));
      publishExport(pptxOut, readFileSync(deckPath), diffOut, lines.join('\n'));
      return { pptx: pptxOut, diff: diffOut, versionCount: versions.length, diffHistoryKnown };
    },
  };
}
