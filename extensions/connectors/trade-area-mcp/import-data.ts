/** 快照式导入：把 trade-area 原仓 ETL 产物复制为本机不可变数据快照。
 * 每次导入：校验结构 → 逐文件哈希 → 评分等价性核对（存储 score 必须与本仓评分端口
 * 重算一致，不一致 fail-closed）→ 原子写入 snapshot.json；同源重导为幂等 no-op。
 * 旧快照归档至 history/ 供追溯；省份解析脏值只记录不修改（数据保持原样）。 */

import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_WEIGHTS, SCORING_ENGINE_VERSION, computeScore } from './scoring.ts';
import { KNOWN_PROVINCES, type DataIndex, type DistrictSummary, type SnapshotManifest } from './types.ts';
import { sha256, canonical, snapshotDigest, readSnapshotFile, readSnapshotManifest } from './snapshot.ts';

export interface ImportOptions {
  sourceDir: string;
  dataRoot: string;
  /** 原仓 git HEAD（版本身份的一环；未知时传 'unknown' 如实记录） */
  sourceHead: string;
  knownProvinces?: Set<string>;
}

export interface ImportReport {
  result: 'imported' | 'unchanged';
  total: number;
  shardCount: number;
  snapshotDigest: string;
  scoreEquivalence: { matched: number; mismatched: number };
  warnings: { dirtyProvinces: { id: string; name: string; province: string }[] };
}

function readSource(sourceDir: string): { indexBuffer: Buffer; index: DataIndex; shards: { name: string; buffer: Buffer }[] } {
  const indexPath = path.join(sourceDir, 'index.json');
  if (!existsSync(indexPath)) throw new Error(`import: 源目录缺少 index.json（${indexPath}）`);
  const indexBuffer = readFileSync(indexPath);
  const index = JSON.parse(indexBuffer.toString('utf8')) as DataIndex;
  if (typeof index.generatedAt !== 'string' || !Number.isFinite(Date.parse(index.generatedAt)) || !Array.isArray(index.districts) || index.total !== index.districts.length) {
    throw new Error(`import: index.json 结构校验失败（total=${String(index.total)} 实际 ${index.districts?.length}）`);
  }
  const detailsDir = path.join(sourceDir, 'details');
  if (!existsSync(detailsDir)) throw new Error(`import: 源目录缺少 details/（${detailsDir}）`);
  const shards = readdirSync(detailsDir).filter(name => /^s\d+\.json$/.test(name)).sort().map(name => ({ name, buffer: readFileSync(path.join(detailsDir, name)) }));
  if (!shards.length) throw new Error('import: details/ 下没有 s{N}.json 分片');
  const summaries = new Map<string, DistrictSummary>();
  for (const district of index.districts) {
    if (!district || typeof district.id !== 'string' || !district.id.trim() || summaries.has(district.id) || !Number.isSafeInteger(district.shard) || district.shard < 0) throw new Error('import: detail identity/index shard 无效或重复');
    summaries.set(district.id, district);
  }
  const seen = new Set<string>();
  for (const shard of shards) {
    const records: unknown = JSON.parse(shard.buffer.toString('utf8'));
    if (!Array.isArray(records)) throw new Error(`import: details/${shard.name} 须为详情数组`);
    for (const record of records) {
      if (!record || typeof record !== 'object' || typeof record.id !== 'string' || seen.has(record.id)) throw new Error('import: detail identity 缺失或重复');
      const summary = summaries.get(record.id);
      if (!summary || `s${summary.shard}.json` !== shard.name || Object.entries(summary).some(([key, value]) => canonical(record[key]) !== canonical(value))
        || !record.dimensions || typeof record.dimensions !== 'object' || Array.isArray(record.dimensions)) throw new Error('import: detail 与 index 的身份、字段或分片不一致');
      seen.add(record.id);
    }
  }
  if (seen.size !== summaries.size) throw new Error('import: detail 分片不完整，拒绝导入缺失详情');
  return { indexBuffer, index, shards };
}

function verifyScoreEquivalence(districts: DistrictSummary[]) {
  let matched = 0;
  const mismatched: { id: string; stored: number | null; recomputed: number | null }[] = [];
  for (const district of districts) {
    const recomputed = computeScore(district.percentiles, DEFAULT_WEIGHTS).score;
    if (recomputed === district.score) matched++;
    else mismatched.push({ id: district.id, stored: district.score, recomputed });
    if (mismatched.length >= 20) break;
  }
  if (mismatched.length) {
    const first = mismatched[0];
    throw new Error(`import: score equivalence 校验失败：${matched}/${districts.length} 一致，首个不一致 id=${first.id} stored=${String(first.stored)} recomputed=${String(first.recomputed)}；拒绝导入口径不一致的数据`);
  }
  return { matched, mismatched: 0 };
}

export function importTradeAreaData(options: ImportOptions): ImportReport {
  const { sourceDir, dataRoot, sourceHead } = options;
  const knownProvinces = options.knownProvinces ?? KNOWN_PROVINCES;
  const { indexBuffer, index, shards } = readSource(sourceDir);
  const scoreEquivalence = verifyScoreEquivalence(index.districts);
  const dirtyProvinces = index.districts
    .filter(district => !knownProvinces.has(district.province))
    .map(district => ({ id: district.id, name: district.name, province: district.province }));

  const files: SnapshotManifest['files'] = [
    { path: 'index.json', sha256: sha256(indexBuffer), bytes: indexBuffer.byteLength },
    ...shards.map(shard => ({ path: `details/${shard.name}`, sha256: sha256(shard.buffer), bytes: shard.buffer.byteLength })),
  ];
  const identity = {
    schemaVersion: 1 as const,
    datasetId: 'optracall-tradearea-data' as const,
    sourceRepo: 'trade-area' as const,
    sourceHead,
    engineVersion: SCORING_ENGINE_VERSION,
    generatedAt: index.generatedAt,
    total: index.total,
    importerVersion: 2,
    files,
  };
  const digest = snapshotDigest(identity);

  const snapshotPath = path.join(dataRoot, 'snapshot.json');
  mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
  const lock = path.join(dataRoot, '.import.lock');
  const handle = openSync(lock, 'wx', 0o600);
  try {
    writeFileSync(handle, `${process.pid}\n`);
    const preserveVersion = (manifest: SnapshotManifest, buffers: { path: string; bytes: Buffer }[]) => {
      const versions = path.join(dataRoot, 'versions'), destination = path.join(versions, manifest.digest);
      mkdirSync(versions, { recursive: true, mode: 0o700 });
      if (existsSync(destination)) {
        const saved = readSnapshotManifest(destination);
        if (saved.digest !== manifest.digest) throw new Error('import: stored version identity mismatch');
        for (const entry of saved.files) readSnapshotFile(destination, saved, entry.path);
        return saved;
      }
      const stage = mkdtempSync(path.join(dataRoot, '.import-'));
      mkdirSync(path.join(stage, 'details'), { mode: 0o700 });
      for (const entry of buffers) writeFileSync(path.join(stage, entry.path), entry.bytes, { flag: 'wx', mode: 0o400, flush: true });
      writeFileSync(path.join(stage, 'snapshot.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o400, flush: true });
      renameSync(stage, destination);
      return manifest;
    };
    const existing = existsSync(snapshotPath) ? readSnapshotManifest(dataRoot) : undefined;
    if (existing) {
      const oldBuffers = existing.files.map(entry => ({ path: entry.path, bytes: readSnapshotFile(dataRoot, existing, entry.path) }));
      if (existing.digest === digest) return { result: 'unchanged', total: index.total, shardCount: shards.length, snapshotDigest: digest, scoreEquivalence, warnings: { dirtyProvinces } };
      preserveVersion(existing, oldBuffers);
    }
    const manifest = preserveVersion({ ...identity, importedAt: new Date().toISOString(), digest }, [
      { path: 'index.json', bytes: indexBuffer }, ...shards.map(shard => ({ path: `details/${shard.name}`, bytes: shard.buffer })),
    ]);
    if (existing) {
      mkdirSync(path.join(dataRoot, 'history'), { recursive: true, mode: 0o700 });
      const archived = path.join(dataRoot, 'history', `snapshot-${existing.digest}.json`);
      if (!existsSync(archived)) writeFileSync(archived, JSON.stringify(existing, null, 2), { flag: 'wx', mode: 0o400, flush: true });
    }
    const tmp = `${snapshotPath}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600, flush: true });
    renameSync(tmp, snapshotPath);
    return { result: 'imported', total: index.total, shardCount: shards.length, snapshotDigest: digest, scoreEquivalence, warnings: { dirtyProvinces } };
  } finally { closeSync(handle); unlinkSync(lock); }
}
