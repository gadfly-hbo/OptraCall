/** stdio 入口：Host 经 pi SDK registerMcpServer 以 stdio transport 拉起本进程。
 * 数据根来自 TRADEAREA_DATA_ROOT 环境变量（Host 注入）或 --data-root 参数；
 * 二者皆缺时明确报错退出，不静默猜测数据位置。 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createTradeAreaServer } from './server.ts';

function resolveDataRoot(): string {
  const flagIndex = process.argv.indexOf('--data-root');
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) return process.argv[flagIndex + 1];
  const fromEnv = process.env.TRADEAREA_DATA_ROOT;
  if (fromEnv) return fromEnv;
  process.stderr.write(`trade-area-mcp: 缺少数据根。用 --data-root <dir> 或环境变量 TRADEAREA_DATA_ROOT 指定（导入脚本产物目录）。\n`);
  process.exit(2);
}

const { server } = createTradeAreaServer({ dataRoot: resolveDataRoot() });
await server.connect(new StdioServerTransport());
