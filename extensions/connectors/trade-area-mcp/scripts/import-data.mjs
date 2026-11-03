#!/usr/bin/env node
/** CLI 包装：node extensions/connectors/trade-area-mcp/scripts/import-data.mjs
 *   --source <trade-area ETL 产物目录，含 index.json 与 details/>
 *   --data-root <目标数据根，如 <dataRoot>/connectors/trade-area>
 *   --source-head <原仓 git HEAD，默认 unknown 如实记录>
 * 报告以 JSON 打印到 stdout；评分等价性不一致或结构校验失败时非零退出、不写入。 */

import { importTradeAreaData } from '../import-data.ts';

function arg(name) {
  const index = process.argv.indexOf(name);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

const source = arg('--source');
const dataRoot = arg('--data-root');
if (!source || !dataRoot) {
  process.stderr.write('用法: import-data.mjs --source <ETL产物目录> --data-root <目标数据根> [--source-head <git HEAD>]\n');
  process.exit(2);
}

try {
  const report = importTradeAreaData({ sourceDir: source, dataRoot, sourceHead: arg('--source-head') ?? 'unknown' });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
