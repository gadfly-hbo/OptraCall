/** 快照式导入：把 trade-area 原仓 ETL 产物复制为本机不可变数据快照。
 * 每次导入：校验结构 → 逐文件哈希 → 评分等价性核对（存储 score 必须与本仓评分端口
 * 重算一致，不一致 fail-closed）→ 原子写入 snapshot.json；同源重导为幂等 no-op。
 * 旧快照归档至 history/ 供追溯；省份解析脏值只记录不修改（数据保持原样）。 */

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_WEIGHTS, SCORING_ENGINE_VERSION, computeScore } from './scoring.ts';
import { KNOWN_PROVINCES, type DataIndex, type DistrictSummary, type SnapshotManifest } from './types.ts';

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

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function readSource(sourceDir: string): { indexBuffer: Buffer; index: DataIndex; shards: { name: string; buffer: Buffer }[] } {
  const indexPath = path.join(sourceDir, 'index.json');
  if (!existsSync(indexPath)) throw new Error(`import: 源目录缺少 index.json（${indexPath}）`);
  const indexBuffer = readFileSync(indexPath);
  const index = JSON.parse(indexBuffer.toString('utf8')) as DataIndex;
  if (typeof index.generatedAt !== 'string' || !Array.isArray(index.districts) || index.total !== index.districts.length) {
    throw new Error(`import: index.json 结构校验失败（total=${String(index.total)} 实际 ${index.districts?.length}）`);
  }
  const detailsDir = path.join(sourceDir, 'details');
  if (!existsSync(detailsDir)) throw new Error(`import: 源目录缺少 details/（${detailsDir}）`);
  const shards = readdirSync(detailsDir).filter(name => /^s\d+\.json$/.test(name)).sort().map(name => ({ name, buffer: readFileSync(path.join(detailsDir, name)) }));
  if (!shards.length) throw new Error('import: details/ 下没有 s{N}.json 分片');
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
    importerVersion: 1,
    files,
  };
  const digest = sha256(Buffer.from(canonical(identity)));

  const snapshotPath = path.join(dataRoot, 'snapshot.json');
  if (existsSync(snapshotPath)) {
    const existing = JSON.parse(readFileSync(snapshotPath, 'utf8')) as SnapshotManifest;
    if (existing.digest === digest) {
      return { result: 'unchanged', total: index.total, shardCount: shards.length, snapshotDigest: digest, scoreEquivalence, warnings: { dirtyProvinces } };
    }
    mkdirSync(path.join(dataRoot, 'history'), { recursive: true });
    const archived = path.join(dataRoot, 'history', `snapshot-${existing.digest.slice(0, 16)}.json`);
    if (!existsSync(archived)) writeFileSync(archived, JSON.stringify(existing, null, 2));
  }

  mkdirSync(path.join(dataRoot, 'details'), { recursive: true });
  cpSync(path.join(sourceDir, 'index.json'), path.join(dataRoot, 'index.json'));
  for (const shard of shards) cpSync(path.join(sourceDir, 'details', shard.name), path.join(dataRoot, 'details', shard.name));

  const manifest: SnapshotManifest = { ...identity, importedAt: new Date().toISOString(), digest };
  const tmp = `${snapshotPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2));
  renameSync(tmp, snapshotPath);
  return { result: 'imported', total: index.total, shardCount: shards.length, snapshotDigest: digest, scoreEquivalence, warnings: { dirtyProvinces } };
}
