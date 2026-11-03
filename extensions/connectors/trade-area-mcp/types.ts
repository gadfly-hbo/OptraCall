/** 商圈数据连接器的数据契约。
 * 字段语义承接 trade-area 原仓 src/types.ts @2ba41d2（ETL 产物 schema 权威）：
 * 缺失一律字段缺省（无键），score 可 null；未公开数据不造占位值。 */

export type ProjectRating = 'S' | 'A+' | 'A' | 'B' | 'C';
export const RATINGS: readonly ProjectRating[] = ['S', 'A+', 'A', 'B', 'C'];

export type Confidence = 'A' | 'B';

/** 可空数值指标（原仓 DistrictMetrics，键名与口径一致） */
export interface DistrictMetrics {
  buildingArea?: number;
  parking?: number;
  merchants?: number;
  brands?: number;
  firstStores?: number;
  pop3km?: number;
  trafficWeekday?: number;
  trafficWeekend?: number;
  trafficPeak?: number;
  rent?: number;
  openedYear?: number;
  crowdA?: number;
  crowdB?: number;
  crowdC?: number;
  competitors?: number;
}

/** 全体商圈百分位分（0-100，越高越好；逆向指标已翻转；含 ETL 派生键） */
export type PercentileMap = Partial<Record<keyof DistrictMetrics | 'crowdAB' | 'parkingPer10k', number>>;

export interface DistrictSummary {
  id: string;
  name: string;
  address: string;
  province: string;
  city: string;
  rating: ProjectRating | null;
  metrics: DistrictMetrics;
  inferred?: Partial<Record<keyof DistrictMetrics, boolean>>;
  basis?: Partial<Record<keyof DistrictMetrics, 'direct' | 'computed' | 'benchmark'>>;
  percentiles: PercentileMap;
  score: number | null;
  shard: number;
}

export interface DimensionDetail {
  text: string;
  sources: string[];
  confidence: Confidence | null;
}

export interface DistrictDetail extends DistrictSummary {
  dimensions: Partial<Record<string, DimensionDetail>>;
}

export interface DataIndex {
  generatedAt: string;
  total: number;
  districts: DistrictSummary[];
}

export const METRIC_KEYS = Object.keys({
  buildingArea: 0, parking: 0, merchants: 0, brands: 0, firstStores: 0, pop3km: 0,
  trafficWeekday: 0, trafficWeekend: 0, trafficPeak: 0, rent: 0, openedYear: 0,
  crowdA: 0, crowdB: 0, crowdC: 0, competitors: 0,
} satisfies Record<keyof DistrictMetrics, number>) as (keyof DistrictMetrics)[];

/** 数据快照清单：导入时写入，工具结果携带 digest 作版本身份 */
export interface SnapshotManifest {
  schemaVersion: 1;
  datasetId: 'optracall-tradearea-data';
  sourceRepo: 'trade-area';
  sourceHead: string;
  engineVersion: string;
  generatedAt: string;
  total: number;
  importedAt: string;
  importerVersion: number;
  files: { path: string; sha256: string; bytes: number }[];
  digest: string;
}

export interface DataVersion {
  datasetId: string;
  digest: string;
  generatedAt: string;
  total: number;
  sourceHead: string;
  sourceRepo: string;
}

/** 中国 34 个省级行政区，用于导入报告识别省份解析脏值 */
export const KNOWN_PROVINCES = new Set([
  '北京市', '天津市', '上海市', '重庆市', '河北省', '山西省', '内蒙古自治区', '辽宁省', '吉林省', '黑龙江省',
  '江苏省', '浙江省', '安徽省', '福建省', '江西省', '山东省', '河南省', '湖北省', '湖南省', '广东省',
  '广西壮族自治区', '海南省', '四川省', '贵州省', '云南省', '西藏自治区', '陕西省', '甘肃省', '青海省',
  '宁夏回族自治区', '新疆维吾尔自治区', '香港特别行政区', '澳门特别行政区', '台湾省',
]);
