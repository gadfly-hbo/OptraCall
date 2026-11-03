import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHash } from 'node:crypto';
import { DEFAULT_WEIGHTS, computeScore } from '../extensions/connectors/trade-area-mcp/scoring.ts';
import { TradeAreaStore } from '../extensions/connectors/trade-area-mcp/store.ts';
import { importTradeAreaData } from '../extensions/connectors/trade-area-mcp/import-data.ts';
import { createTradeAreaServer, TOOL_DEFINITIONS } from '../extensions/connectors/trade-area-mcp/server.ts';

function district(id: string, name: string, province: string, city: string, rating: string | null, percentiles: Record<string, number>, shard: number, overrides: Record<string, unknown> = {}) {
  const rawMetrics = Object.fromEntries(Object.entries(percentiles).filter(([key]) => key !== 'crowdAB' && key !== 'parkingPer10k'));
  return { id, name, address: `${city}某路 1 号`, province, city, rating, metrics: rawMetrics, percentiles, score: null, shard, ...overrides };
}

function writeSource(dir: string, districts: unknown[], generatedAt = '2026-11-02T08:00:00.000Z') {
  mkdirSync(path.join(dir, 'details'), { recursive: true });
  writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ generatedAt, total: districts.length, districts }));
  const shardCount = Math.max(...districts.map((item: any) => item.shard)) + 1;
  for (let shard = 0; shard < shardCount; shard++) {
    // 真实 ETL 契约：分片文件为 DistrictDetail 的纯数组
    const items = (districts as any[]).filter(item => item.shard === shard).map(item => ({ ...item, dimensions: { '项目名称与地址': { text: `${item.name} 位于 ${item.city}`, sources: ['调研报告'], confidence: 'A' } } }));
    writeFileSync(path.join(dir, 'details', `s${shard}.json`), JSON.stringify(items));
  }
}

// A: 客流三档齐备 → traffic = 80*.4+70*.4+60*.2 = 72；score = (72*30+50*20+40*15+30*10)/75 = 54.1
const A = district('0001', '杭州西湖时代广场', '浙江省', '杭州市', 'B', { trafficWeekday: 80, trafficWeekend: 70, trafficPeak: 60, pop3km: 50, crowdAB: 40, parkingPer10k: 30 }, 0);
// B: 仅工作日客流 → 子权重按比例分摊 traffic = 100；score = (100*30+80*20+60*15+40*10)/75 = 78.7
const B = district('0002', '湖州爱山广场', '浙江省', '湖州市', 'S', { trafficWeekday: 100, pop3km: 80, crowdAB: 60, parkingPer10k: 40 }, 0, { inferred: { trafficWeekday: true } });
// C: 缺客群（crowdAB）→ 默认权重下严格 null；traffic = 60，把 crowd 权重归 0 后 = (60*1+60*1)/2 = 60
const C = district('0003', '上海南京路商圈', '上海市', '上海市', 'A+', { trafficWeekday: 60, trafficWeekend: 60, trafficPeak: 60, pop3km: 60 }, 1);
// D: 缺全部客流子档 → 默认权重 null
const D = district('0004', '广州天河路商圈', '广东省', '广州市', 'A', { pop3km: 70, crowdAB: 50, parkingPer10k: 60 }, 1);
// E: 省份解析脏值（导入报告应记录，数据保持原样）
const E = district('0005', '某解析异常商圈', '广场\n福建省', '福州市', null, { trafficWeekday: 10, trafficWeekend: 10, trafficPeak: 10, pop3km: 10, crowdAB: 10, parkingPer10k: 10 }, 1);

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
  const indexPath = path.join(dataRoot, 'index.json');
  const indexEntry = snapshot.files.find((file: any) => file.path === 'index.json');
  assert.equal(indexEntry.sha256, createHashHex(readFileSync(indexPath)));
  assert.ok(readdirSync(path.join(dataRoot, 'details')).length === 2);
  const round = JSON.parse(readFileSync(path.join(dataRoot, 'details', 's0.json'), 'utf8'));
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

  const keyword = await store.search({ keyword: '爱山' });
  assert.equal(keyword.total, 1);
  assert.equal(keyword.districts[0]!.name, '湖州爱山广场');
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

  const empty = await store.search({ province: '浙江省', page: 9 });
  assert.equal(empty.districts.length, 0);
  assert.ok(empty.dataVersion.digest);
});

test('store detail returns full dimension records across shards and honest missing ids', async () => {
  const { dataRoot } = makeImportedRoot('detail');
  const store = new TradeAreaStore(dataRoot);
  const details = await store.detail(['0002', '0003']);
  assert.equal(details.districts.length, 2);
  const aishan = details.districts.find((item: any) => item.id === '0002')!;
  const namedDimension = aishan.dimensions['项目名称与地址']!;
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
  assert.equal((detail.structuredContent as any).districts[0].name, '杭州西湖时代广场');

  const score = await client.callTool({ name: 'tradearea_score', arguments: { ids: ['0001'] } });
  assert.equal((score.structuredContent as any).results[0].score, 54.1);

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
