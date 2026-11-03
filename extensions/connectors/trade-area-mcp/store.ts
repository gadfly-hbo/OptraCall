/** 商圈数据快照的只读查询层：懒加载 index 与详情分片，所有错误走结构化信封。
 * 数据落位约定见 docs/mcp-connector-integration.md：<dataRoot>/snapshot.json 指向 versions/<digest>/ 完整快照；旧平铺v1只读兼容。 */

import { readSnapshotManifest, readSnapshotFile, snapshotVersion } from './snapshot.ts';
import {
  RATINGS, METRIC_KEYS, KNOWN_PROVINCES,
  type DataIndex, type DataVersion, type DistrictDetail, type DistrictMetrics, type DistrictSummary, type ProjectRating, type SnapshotManifest,
} from './types.ts';
import { DEFAULT_WEIGHTS, computeScore, type ScoreWeights } from './scoring.ts';

export type ToolErrorCode = 'invalid_param' | 'not_found' | 'data_unavailable' | 'capability_unsupported';

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly detail?: unknown;
  constructor(code: ToolErrorCode, message: string, detail?: unknown) {
    super(`${code}: ${message}`);
    this.name = 'ToolError';
    this.code = code;
    this.detail = detail;
  }
}

export interface SearchParams {
  province?: string;
  city?: string;
  rating?: string;
  keyword?: string;
  metrics?: Record<string, { gte?: number; lte?: number }>;
  page?: number;
  pageSize?: number;
}

const MAX_BATCH = 50;
const MAX_PAGE_SIZE = 100;

function asPositiveInt(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new ToolError('invalid_param', `${field} 须为不小于 1 的整数`, { field, value });
  }
  return value;
}

export class TradeAreaStore {
  private readonly dataRoot: string;
  private indexCache?: DataIndex;
  private manifestCache?: SnapshotManifest;
  private readonly shardCache = new Map<number, { districts: DistrictDetail[] }>();

  constructor(dataRoot: string) {
    this.dataRoot = dataRoot;
  }

  private manifest(): SnapshotManifest {
    if (this.manifestCache) return this.manifestCache;
    let parsed: SnapshotManifest;
    try { parsed = readSnapshotManifest(this.dataRoot); }
    catch { throw new ToolError('data_unavailable', '数据快照缺失或身份校验失败，请按连接器README显式导入完整快照。'); }
    this.manifestCache = parsed;
    return parsed;
  }

  private readData<T>(relative: string): T {
    try { return JSON.parse(readSnapshotFile(this.dataRoot, this.manifest(), relative).toString('utf8')) as T; }
    catch { throw new ToolError('data_unavailable', '数据快照内容缺失或与版本身份不符，请显式重新导入核对。'); }
  }

  private index(): DataIndex {
    if (this.indexCache) return this.indexCache;
    this.indexCache = this.readData<DataIndex>('index.json');
    return this.indexCache;
  }

  versionIdentity(): DataVersion {
    return snapshotVersion(this.manifest());
  }

  private shard(shard: number): { districts: DistrictDetail[] } {
    let cached = this.shardCache.get(shard);
    if (cached) return cached;
    const parsed = this.readData<unknown>(`details/s${shard}.json`);
    if (!Array.isArray(parsed)) {
      throw new ToolError('data_unavailable', `详情分片 s${shard}.json 结构非预期的数组（ETL 契约：DistrictDetail[]），拒绝猜测解读`, { shard });
    }
    cached = { districts: parsed as DistrictDetail[] };
    this.shardCache.set(shard, cached);
    return cached;
  }

  private byId(): Map<string, DistrictSummary> {
    const map = new Map<string, DistrictSummary>();
    for (const district of this.index().districts) map.set(district.id, district);
    return map;
  }

  private validateIds(raw: unknown): string[] {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_BATCH || raw.some(id => typeof id !== 'string' || !id.trim())) {
      throw new ToolError('invalid_param', `ids 须为 1–${MAX_BATCH} 个非空字符串`, { received: raw });
    }
    return [...new Set(raw as string[])];
  }

  async search(params: SearchParams) {
    const manifestRequired = this.versionIdentity();
    if (params.province !== undefined && !KNOWN_PROVINCES.has(params.province)) throw new ToolError('invalid_param', 'province 须为已知省级全称；源数据脏值不作为合法省份', { field: 'province' });
    const page = asPositiveInt(params.page, 'page') ?? 1;
    const pageSize = asPositiveInt(params.pageSize, 'pageSize') ?? 20;
    if (pageSize > MAX_PAGE_SIZE) {
      throw new ToolError('invalid_param', `pageSize 最大 ${MAX_PAGE_SIZE}`, { pageSize });
    }
    if (params.rating !== undefined && !RATINGS.includes(params.rating as ProjectRating)) {
      throw new ToolError('invalid_param', `rating 须为 ${RATINGS.join('/')}`, { rating: params.rating });
    }
    const metricFilters: { key: keyof DistrictMetrics; gte?: number; lte?: number }[] = [];
    const allowedMetrics = new Set<string>(METRIC_KEYS);
    if (params.metrics !== undefined) {
      if (typeof params.metrics !== 'object' || params.metrics === null) {
        throw new ToolError('invalid_param', 'metrics 须为对象：{指标名: {gte?, lte?}}');
      }
      for (const [key, range] of Object.entries(params.metrics)) {
        if (!allowedMetrics.has(key)) {
          throw new ToolError('invalid_param', `未知指标 ${key}；可用指标：${METRIC_KEYS.join('/')}`, { metric: key });
        }
        if (typeof range !== 'object' || range === null || Array.isArray(range) || Object.keys(range).some(bound => bound !== 'gte' && bound !== 'lte') || (range.gte === undefined && range.lte === undefined)) {
          throw new ToolError('invalid_param', `${key} 须且仅可包含 gte/lte，至少给出一项`, { metric: key });
        }
        for (const bound of ['gte', 'lte'] as const) {
          if (range[bound] !== undefined && (typeof range[bound] !== 'number' || !Number.isFinite(range[bound]))) {
            throw new ToolError('invalid_param', `${key}.${bound} 须为数值`, { metric: key, bound });
          }
        }
        if (range.gte !== undefined && range.lte !== undefined && range.gte > range.lte) throw new ToolError('invalid_param', `${key}.gte 不得大于 lte`, { metric: key });
        metricFilters.push({ key: key as keyof DistrictMetrics, gte: range.gte, lte: range.lte });
      }
    }
    const keyword = params.keyword?.trim().toLowerCase();
    const rows = this.index().districts.filter(district => {
      if (params.province !== undefined && district.province !== params.province) return false;
      if (params.city !== undefined && district.city !== params.city) return false;
      if (params.rating !== undefined && district.rating !== params.rating) return false;
      if (keyword && !(district.name.toLowerCase().includes(keyword) || district.address.toLowerCase().includes(keyword))) return false;
      for (const { key, gte, lte } of metricFilters) {
        const value = district.metrics[key];
        if (value === undefined) return false;
        if (gte !== undefined && value < gte) return false;
        if (lte !== undefined && value > lte) return false;
      }
      return true;
    }).sort((a, b) => a.id.localeCompare(b.id));
    const start = (page - 1) * pageSize;
    if (page > 1 && start >= rows.length) throw new ToolError('invalid_param', 'page 超出筛选结果范围', { page, pageSize, total: rows.length });
    return {
      total: rows.length,
      page,
      pageSize,
      districts: rows.slice(start, start + pageSize),
      dataVersion: manifestRequired,
    };
  }

  async detail(rawIds: unknown) {
    const dataVersion = this.versionIdentity();
    const ids = this.validateIds(rawIds);
    const districts = this.index().districts;
    const summaryById = new Map(districts.map(district => [district.id, district]));
    const missing = ids.filter(id => !summaryById.has(id));
    if (missing.length) {
      throw new ToolError('not_found', `未找到商圈 ${missing.join('/')}`, { missing });
    }
    const results: DistrictDetail[] = [];
    for (const id of ids) {
      const summary = summaryById.get(id)!;
      const shard = this.shard(summary.shard);
      const found = shard.districts.find(item => item.id === id);
      if (!found) {
        throw new ToolError('data_unavailable', `商圈 ${id} 的详情分片记录缺失，请重新导入数据快照`, { id, shard: summary.shard });
      }
      results.push(found);
    }
    return { districts: results, dataVersion };
  }

  async score(rawInput: { ids?: unknown; weights?: unknown }) {
    const dataVersion = this.versionIdentity();
    const ids = this.validateIds(rawInput.ids);
    let weights: ScoreWeights = DEFAULT_WEIGHTS;
    if (rawInput.weights !== undefined) {
      const raw = rawInput.weights as Partial<ScoreWeights>;
      const keys: (keyof ScoreWeights)[] = ['traffic', 'pop', 'crowd', 'parking'];
      if (typeof raw !== 'object' || raw === null || keys.some(key => raw[key] === undefined) || Object.keys(raw).length !== keys.length) {
        throw new ToolError('invalid_param', 'weights 须包含且仅包含 traffic/pop/crowd/parking 四个数值（0 表示刻意排除该因子）');
      }
      for (const key of keys) {
        if (typeof raw[key] !== 'number' || !Number.isFinite(raw[key]) || (raw[key] as number) < 0) {
          throw new ToolError('invalid_param', `weights.${key} 须为不小于 0 的数值`, { key, value: raw[key] });
        }
      }
      weights = { traffic: raw.traffic!, pop: raw.pop!, crowd: raw.crowd!, parking: raw.parking! };
    }
    const summaryById = this.byId();
    const missing = ids.filter(id => !summaryById.has(id));
    if (missing.length) {
      throw new ToolError('not_found', `未找到商圈 ${missing.join('/')}`, { missing });
    }
    const results = ids.map(id => {
      const summary = summaryById.get(id)!;
      const { score, factors } = computeScore(summary.percentiles, weights);
      // 展示层保留 2 位小数；score 计算仍用未舍入因子（与原仓口径一致）
      return { id, name: summary.name, score, factors: factors.map(factor => ({ ...factor, value: factor.value === null ? null : Math.round(factor.value * 100) / 100 })) };
    });
    return { weights, results, dataVersion };
  }
}
