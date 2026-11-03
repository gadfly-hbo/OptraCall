import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, chmodSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHash } from 'node:crypto';
import { DEFAULT_WEIGHTS, computeScore } from '../extensions/connectors/trade-area-mcp/scoring.ts';
import { TradeAreaStore } from '../extensions/connectors/trade-area-mcp/store.ts';
import { importTradeAreaData } from '../extensions/connectors/trade-area-mcp/import-data.ts';
import { createTradeAreaServer, TOOL_DEFINITIONS } from '../extensions/connectors/trade-area-mcp/server.ts';
import { snapshotDigest } from '../extensions/connectors/trade-area-mcp/snapshot.ts';

function district(id: string, name: string, province: string, city: string, rating: string | null, percentiles: Record<string, number>, shard: number, overrides: Record<string, unknown> = {}) {
  const rawMetrics = Object.fromEntries(Object.entries(percentiles).filter(([key]) => key !== 'crowdAB' && key !== 'parkingPer10k'));
  return { id, name, address: `${city}某路 1 号`, province, city, rating, metrics: rawMetrics, percentiles, score: null, shard, ...overrides };
}

function writeSource(dir: string, districts: unknown[], generatedAt = '2026-11-02T08:00:00.000Z') {
  mkdirSync(path.join(dir, 'details'), { recursive: true });
  // This helper replaces its own synthetic source snapshot, including its shard set.
  // Otherwise a smaller second fixture leaves orphan records from the first one.
  for (const name of readdirSync(path.join(dir, 'details'))) if (/^s\d+\.json$/.test(name)) unlinkSync(path.join(dir, 'details', name));
  writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ generatedAt, total: districts.length, districts }));
  const shardCount = Math.max(...districts.map((item: any) => item.shard)) + 1;
  for (let shard = 0; shard < shardCount; shard++) {
    // 真实 ETL 契约：分片文件为 DistrictDetail 的纯数组
    const items = (districts as any[]).filter(item => item.shard === shard).map(item => ({ ...item, dimensions: { '项目名称与地址': { text: `${item.name} 位于 ${item.city}`, sources: ['调研报告'], confidence: 'A' } } }));
    writeFileSync(path.join(dir, 'details', `s${shard}.json`), JSON.stringify(items));
  }
}

// All names, ids, metrics, dimensions and scores below are synthetic, not records from the private snapshot.
// Real province/city enum strings exercise filtering only; they do not identify a business.
// A: 客流三档齐备 → traffic = 80*.4+70*.4+60*.2 = 72；score = (72*30+50*20+40*15+30*10)/75 = 54.1
const A = district('0001', '合成商圈A', '浙江省', '杭州市', 'B', { trafficWeekday: 80, trafficWeekend: 70, trafficPeak: 60, pop3km: 50, crowdAB: 40, parkingPer10k: 30 }, 0);
// B: 仅工作日客流 → 子权重按比例分摊 traffic = 100；score = (100*30+80*20+60*15+40*10)/75 = 78.7
const B = district('0002', '合成商圈B', '浙江省', '湖州市', 'S', { trafficWeekday: 100, pop3km: 80, crowdAB: 60, parkingPer10k: 40 }, 0, { inferred: { trafficWeekday: true } });
// C: 缺客群（crowdAB）→ 默认权重下严格 null；traffic = 60，把 crowd 权重归 0 后 = (60*1+60*1)/2 = 60
const C = district('0003', '合成商圈C', '上海市', '上海市', 'A+', { trafficWeekday: 60, trafficWeekend: 60, trafficPeak: 60, pop3km: 60 }, 1);
// D: 缺全部客流子档 → 默认权重 null
const D = district('0004', '合成商圈D', '广东省', '广州市', 'A', { pop3km: 70, crowdAB: 50, parkingPer10k: 60 }, 1);
// E: 省份解析脏值（导入报告应记录，数据保持原样）
const E = district('0005', '合成异常商圈E', '广场\n福建省', '福州市', null, { trafficWeekday: 10, trafficWeekend: 10, trafficPeak: 10, pop3km: 10, crowdAB: 10, parkingPer10k: 10 }, 1);

const ALL = [A, B, C, D, E];
const PROVINCES = new Set(['北京市', '天津市', '上海市', '重庆市', '河北省', '山西省', '内蒙古自治区', '辽宁省', '吉林省', '黑龙江省', '江苏省', '浙江省', '安徽省', '福建省', '江西省', '山东省', '河南省', '湖北省', '湖南省', '广东省', '广西壮族自治区', '海南省', '四川省', '贵州省', '云南省', '西藏自治区', '陕西省', '甘肃省', '青海省', '宁夏回族自治区', '新疆维吾尔自治区', '香港特别行政区', '澳门特别行政区', '台湾省']);

function scored(districts: any[]) {
  return districts.map(item => ({ ...item, score: computeScore(item.percentiles, DEFAULT_WEIGHTS).score }));
}

function makeImportedRoot(dirName: string, districts = ALL) {
  const root = mkdtempSync(path.join(os.tmpdir(), `optracall-tradearea-${dirName}-`));
  const source = path.join(root, 'source');
  writeSource(source, scored(districts));
  const dataRoot = path.join(root, 'data');
  const report = importTradeAreaData({ sourceDir: source, dataRoot, sourceHead: '2ba41d2', knownProvinces: PROVINCES });
  return { root, source, dataRoot, report };
}

test('scoring port matches trade-area reference math (weights, sub-weight split, strict null, rounding)', () => {
  assert.equal(DEFAULT_WEIGHTS.traffic, 30);
  assert.deepEqual(computeScore(A.percentiles, DEFAULT_WEIGHTS), { score: 54.1, factors: [
    { key: 'traffic', label: '客流', value: 72, weight: 30 },
    { key: 'pop', label: '3公里人口', value: 50, weight: 20 },
    { key: 'crowd', label: '客群匹配', value: 40, weight: 15 },
    { key: 'parking', label: '停车便利', value: 30, weight: 10 },
  ] });
  assert.equal(computeScore(B.percentiles, DEFAULT_WEIGHTS).score, 78.7);
  assert.equal(computeScore(C.percentiles, DEFAULT_WEIGHTS).score, null);
  assert.equal(computeScore(C.percentiles, { traffic: 1, pop: 1, crowd: 0, parking: 0 })!.score, 60);
  assert.equal(computeScore(D.percentiles, DEFAULT_WEIGHTS).score, null);
  assert.equal(computeScore(A.percentiles, { traffic: 0, pop: 0, crowd: 0, parking: 0 }).score, null);
});

for (const scale of [1e308, Number.MIN_VALUE]) test(`TA04: finite weight scale ${scale} preserves proportional scores and missing semantics`, async () => {
  const fractional = { trafficWeekday: 60.25, pop3km: 60.25, crowdAB: 60.25, parkingPer10k: 60.25 };
  const { dataRoot } = makeImportedRoot('extreme-weights');
  const store = new TradeAreaStore(dataRoot);
    const weights = { traffic: scale, pop: scale, crowd: scale, parking: scale };
    const result = computeScore(fractional, weights);
    assert.equal(result.score, 60.3, 'extreme equal weights must retain fractional score rather than overflow or round subnormal products');
    assert.ok(result.factors.every(factor => factor.weight === scale), 'normalization must not change the reported caller weights');
    assert.equal((await store.score({ ids: [A.id], weights })).results[0].score, 48);
    assert.equal(computeScore(C.percentiles, weights).score, null, 'a genuinely missing enabled factor remains null');
  assert.equal(computeScore(C.percentiles, { traffic: 1e308, pop: 1e308, crowd: Number.MIN_VALUE, parking: 0 }).score, null, 'an enabled missing factor cannot disappear when its normalized weight underflows');
  const tinyRatio = Number.MIN_VALUE;
  assert.equal(computeScore(A.percentiles, { traffic: tinyRatio, pop: tinyRatio * 2, crowd: tinyRatio * 3, parking: tinyRatio * 4 }).score, 41.2);
});

test('TA04: proportional fractional scores survive subnormal products even with a normal total weight', () => {
  for (const value of [0.05, 0.25]) {
    const percentiles = { trafficWeekday: value, pop3km: value, crowdAB: value, parkingPer10k: value };
    for (const scale of [1, 3, 1e-300, 1e-308, 1e-307]) {
      assert.equal(computeScore(percentiles, { traffic: scale, pop: scale, crowd: scale, parking: scale }).score, value === 0.05 ? 0.1 : 0.3, `value ${value}, proportional weight ${scale}`);
    }
  }
});

test('import writes immutable snapshot with version identity, verifies score equivalence, reports dirty provinces', () => {
  const { dataRoot, report } = makeImportedRoot('import');
  assert.equal(report.result, 'imported');
  assert.equal(report.total, 5);
  assert.equal(report.scoreEquivalence.matched, 5);
  assert.equal(report.scoreEquivalence.mismatched, 0);
  assert.deepEqual(report.warnings.dirtyProvinces.map((item: any) => item.id), ['0005']);
  const snapshot = JSON.parse(readFileSync(path.join(dataRoot, 'snapshot.json'), 'utf8'));
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.datasetId, 'optracall-tradearea-data');
  assert.equal(snapshot.sourceRepo, 'trade-area');
  assert.equal(snapshot.sourceHead, '2ba41d2');
  assert.equal(snapshot.generatedAt, '2026-11-02T08:00:00.000Z');
  assert.equal(snapshot.total, 5);
  assert.ok(snapshot.digest.length === 64);
  assert.ok(snapshot.files.length >= 3);
  const versionRoot = path.join(dataRoot, 'versions', snapshot.digest);
  const indexPath = path.join(versionRoot, 'index.json');
  const indexEntry = snapshot.files.find((file: any) => file.path === 'index.json');
  assert.equal(indexEntry.sha256, createHashHex(readFileSync(indexPath)));
  assert.ok(readdirSync(path.join(versionRoot, 'details')).length === 2);
  const round = JSON.parse(readFileSync(path.join(versionRoot, 'details', 's0.json'), 'utf8'));
  assert.equal(Array.isArray(round), true);
  assert.equal(round.length, 2);
});

function createHashHex(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

test('re-import of identical source is an idempotent no-op; changed source gets a new digest', () => {
  const { source, dataRoot, report } = makeImportedRoot('idempotent');
  const before = JSON.parse(readFileSync(path.join(dataRoot, 'snapshot.json'), 'utf8'));
  const again = importTradeAreaData({ sourceDir: source, dataRoot, sourceHead: '2ba41d2', knownProvinces: PROVINCES });
  assert.equal(again.result, 'unchanged');
  assert.deepEqual(JSON.parse(readFileSync(path.join(dataRoot, 'snapshot.json'), 'utf8')), before);
  const index = JSON.parse(readFileSync(path.join(source, 'index.json'), 'utf8'));
  index.districts[0].name = '改名后的商圈';
  writeFileSync(path.join(source, 'index.json'), JSON.stringify(index));
  writeSource(source, scored([B])); // 全量重写为另一份内容（含正确 score）
  const changed = importTradeAreaData({ sourceDir: source, dataRoot, sourceHead: '2ba41d2', knownProvinces: PROVINCES });
  assert.equal(changed.result, 'imported');
  const after = JSON.parse(readFileSync(path.join(dataRoot, 'snapshot.json'), 'utf8'));
  assert.notEqual(after.digest, before.digest);
});

test('R1: a lazy reader remains on its original complete snapshot after explicit re-import', async () => {
  const { source, dataRoot } = makeImportedRoot('pinned-version');
  const oldReader = new TradeAreaStore(dataRoot);
  const originalVersion = oldReader.versionIdentity(); // Only the manifest is loaded, not index/shards.
  writeSource(source, scored([B]), '2026-11-03T00:00:00.000Z');
  const update = importTradeAreaData({ sourceDir: source, dataRoot, sourceHead: 'synthetic-new-head' });
  assert.notEqual(update.snapshotDigest, originalVersion.digest);
  assert.equal((await oldReader.search({})).total, 5, 'old manifest must never label newly replaced index bytes');
  assert.equal((await oldReader.detail([A.id])).districts[0].name, A.name);
  assert.equal((await new TradeAreaStore(dataRoot).search({})).total, 1);
  const archived = new TradeAreaStore(path.join(dataRoot, 'versions', originalVersion.digest));
  assert.deepEqual(archived.versionIdentity(), originalVersion);
  assert.equal((await archived.detail([A.id])).districts[0].name, A.name, 'history must retain old data, not only its hash list');
});

test('TA02: incomplete source details fail closed and preserve the current snapshot', () => {
  const { source, dataRoot } = makeImportedRoot('missing-details');
  const before = readFileSync(path.join(dataRoot, 'snapshot.json'));
  unlinkSync(path.join(source, 'details/s1.json'));
  assert.throws(() => importTradeAreaData({ sourceDir: source, dataRoot, sourceHead: 'synthetic-invalid' }), /detail|分片/i);
  assert.deepEqual(readFileSync(path.join(dataRoot, 'snapshot.json')), before, 'failed import must not publish an incomplete snapshot');
});

test('R1: upgrading a legacy flat snapshot preserves its reader, bytes and complete historical data', async () => {
  const { root, source, dataRoot } = makeImportedRoot('legacy-version');
  const modern = JSON.parse(readFileSync(path.join(dataRoot, 'snapshot.json'), 'utf8'));
  const legacy = { ...modern, importerVersion: 1 }; legacy.digest = snapshotDigest(legacy);
  const legacyRoot = path.join(root, 'legacy'), original = new Map<string, Buffer>();
  mkdirSync(path.join(legacyRoot, 'details'), { recursive: true });
  for (const entry of modern.files) {
    const bytes = readFileSync(path.join(dataRoot, 'versions', modern.digest, entry.path));
    original.set(entry.path, bytes); writeFileSync(path.join(legacyRoot, entry.path), bytes);
  }
  writeFileSync(path.join(legacyRoot, 'snapshot.json'), JSON.stringify(legacy));
  const oldReader = new TradeAreaStore(legacyRoot), oldVersion = oldReader.versionIdentity();
  assert.equal(oldVersion.importerVersion, 1);
  writeSource(source, scored([B]), '2026-11-03T00:00:00.000Z');
  const update = importTradeAreaData({ sourceDir: source, dataRoot: legacyRoot, sourceHead: 'synthetic-v2' });
  assert.notEqual(update.snapshotDigest, legacy.digest);
  for (const [relative, bytes] of original) assert.deepEqual(readFileSync(path.join(legacyRoot, relative)), bytes, 'legacy flat bytes must not be overwritten');
  assert.equal((await oldReader.search({})).total, 5);
  assert.equal((await new TradeAreaStore(legacyRoot).search({})).total, 1);
  const historical = new TradeAreaStore(path.join(legacyRoot, 'versions', legacy.digest));
  assert.deepEqual(historical.versionIdentity(), oldVersion);
  assert.equal((await historical.detail([A.id])).districts[0].name, A.name);
});

test('R1: identical re-import detects stored corruption without overwriting or pretending an unchanged success', () => {
  const { source, dataRoot, report } = makeImportedRoot('corrupt-version');
  const manifest = readFileSync(path.join(dataRoot, 'snapshot.json'));
  const file = path.join(dataRoot, 'versions', report.snapshotDigest, 'index.json');
  chmodSync(file, 0o600); writeFileSync(file, 'CORRUPTED_SYNTHETIC_VERSION');
  assert.throws(() => importTradeAreaData({ sourceDir: source, dataRoot, sourceHead: '2ba41d2' }), /snapshot: content mismatch/);
  assert.deepEqual(readFileSync(path.join(dataRoot, 'snapshot.json')), manifest);
  assert.equal(readFileSync(file, 'utf8'), 'CORRUPTED_SYNTHETIC_VERSION', 'failed evidence must not be silently repaired');
  assert.deepEqual(readdirSync(path.join(dataRoot, 'versions')), [report.snapshotDigest]);
});

test('import fails closed when stored scores disagree with the scoring port', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'optracall-tradearea-badsource-'));
  const source = path.join(root, 'source');
  const corrupted = scored([A, B]);
  corrupted[0].score = 99.9;
  writeSource(source, corrupted);
  assert.throws(() => importTradeAreaData({ sourceDir: source, dataRoot: path.join(root, 'data'), sourceHead: 'x', knownProvinces: PROVINCES }), /score equivalence/);
});

test('store search filters by province, keyword, rating and metric thresholds with paging', async () => {
  const { dataRoot } = makeImportedRoot('search');
  const store = new TradeAreaStore(dataRoot);
  const version = store.versionIdentity();
  assert.equal(version.datasetId, 'optracall-tradearea-data');
  assert.equal(version.total, 5);
  assert.equal(version.sourceHead, '2ba41d2');

  const zhejiang = await store.search({ province: '浙江省' });
  assert.equal(zhejiang.total, 2);
  assert.deepEqual(zhejiang.districts.map((item: any) => item.id), ['0001', '0002']);

  const keyword = await store.search({ keyword: '合成商圈B' });
  assert.equal(keyword.total, 1);
  assert.equal(keyword.districts[0]!.name, '合成商圈B');
  assert.equal(keyword.districts[0]!.inferred!.trafficWeekday, true);

  const rated = await store.search({ rating: 'S' });
  assert.equal(rated.total, 1);

  const busy = await store.search({ metrics: { trafficWeekday: { gte: 60 } } });
  assert.equal(busy.total, 3);

  const paged = await store.search({ province: '浙江省', page: 2, pageSize: 1 });
  assert.equal(paged.total, 2);
  assert.equal(paged.districts.length, 1);
  assert.equal(paged.districts[0].id, '0002');
  assert.equal(paged.page, 2);

  await assert.rejects(store.search({ province: '浙江省', page: 9 }), (error: any) => error.code === 'invalid_param', 'TA05 requires an out-of-range error rather than an empty page');
});

test('store detail returns full dimension records across shards and honest missing ids', async () => {
  const { dataRoot } = makeImportedRoot('detail');
  const store = new TradeAreaStore(dataRoot);
  const details = await store.detail(['0002', '0003']);
  assert.equal(details.districts.length, 2);
  const sampleB = details.districts.find((item: any) => item.id === '0002')!;
  const namedDimension = sampleB.dimensions['项目名称与地址']!;
  assert.equal(namedDimension.confidence, 'A');
  assert.deepEqual(namedDimension.sources, ['调研报告']);
  await assert.rejects(() => store.detail(['0002', 'nope']), /not_found/);
});

test('store score uses caller weights with strict missing semantics and honest nulls', async () => {
  const { dataRoot } = makeImportedRoot('score');
  const store = new TradeAreaStore(dataRoot);
  const defaults = await store.score({ ids: ['0001', '0002', '0003', '0004'] });
  assert.equal(defaults.results.find((item: any) => item.id === '0001')!.score, 54.1);
  assert.equal(defaults.results.find((item: any) => item.id === '0002')!.score, 78.7);
  assert.equal(defaults.results.find((item: any) => item.id === '0003')!.score, null);
  assert.equal(defaults.results.find((item: any) => item.id === '0004')!.score, null);
  const custom = await store.score({ ids: ['0003'], weights: { traffic: 1, pop: 1, crowd: 0, parking: 0 } });
  assert.equal(custom.results[0].score, 60);
  const factors = custom.results[0].factors.filter((factor: any) => factor.weight > 0);
  assert.equal(factors.length, 2);
});

test('tools reject invalid parameters with structured envelopes', async () => {
  const { dataRoot } = makeImportedRoot('errors');
  const store = new TradeAreaStore(dataRoot);
  await assert.rejects(() => store.search({ pageSize: 500 }), /invalid_param/);
  await assert.rejects(() => store.search({ metrics: { notAMetric: { gte: 1 } } }), /invalid_param/);
  await assert.rejects(() => store.search({ rating: 'X' }), /invalid_param/);
  await assert.rejects(() => store.detail([]), /invalid_param/);
  await assert.rejects(() => store.score({ ids: ['0001'], weights: { traffic: -1, pop: 0, crowd: 0, parking: 0 } }), /invalid_param/);
});

test('server exposes three read-only tools over the MCP protocol with structured results and errors', async () => {
  const { dataRoot } = makeImportedRoot('mcp');
  const { server } = createTradeAreaServer({ dataRoot });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['tradearea_detail', 'tradearea_score', 'tradearea_search']);
  assert.ok(tools.tools.every(tool => tool.annotations?.readOnlyHint === true));
  assert.ok(tools.tools.every(tool => TOOL_DEFINITIONS.some(def => def.name === tool.name && def.description === tool.description)));

  const search = await client.callTool({ name: 'tradearea_search', arguments: { province: '浙江省' } });
  assert.equal(search.isError, undefined);
  const payload = search.structuredContent as any;
  assert.equal(payload.total, 2);
  assert.equal(payload.dataVersion.datasetId, 'optracall-tradearea-data');

  const detail = await client.callTool({ name: 'tradearea_detail', arguments: { ids: ['0001'] } });
  assert.equal((detail.structuredContent as any).districts[0].name, '合成商圈A');

  const score = await client.callTool({ name: 'tradearea_score', arguments: { ids: ['0001'] } });
  assert.equal((score.structuredContent as any).results[0].score, 54.1);

  const extreme = await client.callTool({ name: 'tradearea_score', arguments: { ids: ['0001'], weights: { traffic: 1e308, pop: 1e308, crowd: 1e308, parking: 1e308 } } });
  assert.equal((extreme.structuredContent as any).results[0].score, 48, 'protocol must not turn arithmetic NaN into missing-data null');

  const bad = await client.callTool({ name: 'tradearea_search', arguments: { pageSize: 500 } });
  assert.equal(bad.isError, true);
  const envelope = JSON.parse((bad.content as any[]).find(part => part.type === 'text').text);
  assert.equal(envelope.error.code, 'invalid_param');
  assert.ok(envelope.error.message.includes('pageSize'));

  await client.close();
  await server.close();
});

test('store without an imported snapshot answers data_unavailable instead of guessing', async () => {
  const emptyRoot = mkdtempSync(path.join(os.tmpdir(), 'optracall-tradearea-empty-'));
  const store = new TradeAreaStore(emptyRoot);
  await assert.rejects(() => store.search({}), /data_unavailable/);
});

test('TA05: MCP preserves and rejects unknown or incomplete object keys with structured errors', async t => {
  const { dataRoot } = makeImportedRoot('protocol-exact-keys');
  const { server } = createTradeAreaServer({ dataRoot });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'synthetic-key-contract', version: '1.0.0' });
  await server.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const invalid = [
    { name: 'tradearea_score', arguments: { ids: [A.id], weights: { traffic: 1, pop: 1, crowd: 1, parking: 1, extra: 1 } } },
    { name: 'tradearea_score', arguments: { ids: [A.id], weights: { traffic: 1 } } },
    { name: 'tradearea_search', arguments: { metrics: { trafficWeekday: { gte: 0, extra: 1 } } } },
    { name: 'tradearea_search', arguments: { extra: 1 } },
    { name: 'tradearea_detail', arguments: { ids: [A.id], extra: 1 } },
  ];
  for (const request of invalid) {
    const result = await client.callTool(request);
    assert.equal(result.isError, true, `${request.name} must reject precise-key violations, never silently remove them`);
    const envelope = JSON.parse((result.content as any[]).find(item => item.type === 'text').text);
    assert.equal(envelope.error.code, 'invalid_param');
  }
});

test('TA05: pages beyond the filtered result range return invalid_param, not a misleading empty page', async () => {
  const { dataRoot } = makeImportedRoot('page-range');
  const store = new TradeAreaStore(dataRoot);
  await assert.rejects(store.search({ page: 2, pageSize: 100 }), (error: any) => error.code === 'invalid_param');
  await assert.rejects(store.search({ page: 1e20 }), (error: any) => error.code === 'invalid_param');
  assert.deepEqual((await store.search({ keyword: '没有匹配项', page: 1 })).districts, [], 'first empty page is an honest empty search');
});

test('TA03: dirty province text remains raw data but cannot masquerade as an accepted province filter', async () => {
  const { dataRoot, report } = makeImportedRoot('province-filter');
  const store = new TradeAreaStore(dataRoot);
  await assert.rejects(store.search({ province: E.province }), (error: any) => error.code === 'invalid_param');
  assert.equal((await store.detail([E.id])).districts[0].province, E.province, 'do not invent a cleaned province or delete the original district');
  assert.deepEqual(report.warnings.dirtyProvinces.map(item => item.id), [E.id]);
});

test('TA05: invalid numeric filter intervals are errors rather than empty or silently unbounded results', async () => {
  const { dataRoot } = makeImportedRoot('metric-range');
  const store = new TradeAreaStore(dataRoot);
  await assert.rejects(store.search({ metrics: { parking: { gte: 100, lte: 1 } } }), (error: any) => error.code === 'invalid_param');
  await assert.rejects(store.search({ metrics: { parking: { gte: NaN } } }), (error: any) => error.code === 'invalid_param');
});
