import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { importTradeAreaData } from '../../extensions/connectors/trade-area-mcp/import-data.ts';

/** Entirely synthetic; the literal equal-factor scores are independent of the candidate engine. */
export function importSyntheticTradeArea(source: string, dataRoot: string) {
  mkdirSync(path.join(source, 'details'), { recursive: true });
  const districts = [60, 80].map((value, index) => ({
    id: `synthetic-${index + 1}`, name: `合成商圈${index + 1}`, address: `合成路${index + 1}号`, province: '浙江省', city: '合成市', rating: 'B',
    metrics: { trafficWeekday: index + 1, parking: 100 },
    percentiles: { trafficWeekday: value, trafficWeekend: value, trafficPeak: value, pop3km: value, crowdAB: value, parkingPer10k: value },
    score: value, shard: 0,
  }));
  writeFileSync(path.join(source, 'index.json'), JSON.stringify({ generatedAt: '2026-11-01T00:00:00.000Z', total: 2, districts }));
  writeFileSync(path.join(source, 'details/s0.json'), JSON.stringify(districts.map(item => ({ ...item, dimensions: { '合成维度': { text: '仅为合成合同样例，不代表任何真实经营情况。', sources: ['synthetic'], confidence: 'A' } } }))));
  return importTradeAreaData({ sourceDir: source, dataRoot, sourceHead: 'synthetic-only' });
}
