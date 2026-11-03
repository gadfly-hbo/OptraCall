/** MCP server 本体：三个只读工具，标准 MCP 协议（stdio 或 in-memory transport）。
 * Host 侧经 pi SDK `registerMcpServer` 以 stdio 形态注册（见 docs/mcp-connector-integration.md）；
 * 工具结果统一携带 dataVersion（数据快照版本身份）；错误以 isError + 结构化信封返回，
 * 供 Agent 自主纠错；readOnlyHint 如实标注且不作权限依据。 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TradeAreaStore, ToolError } from './store.ts';
import { METRIC_KEYS, RATINGS } from './types.ts';

export interface ToolDefinition {
  name: string;
  description: string;
  readonly: true;
  inputShape: z.ZodRawShape;
}

const DATA_HINT = '数据为快照导入的已核定商圈档案（缺失字段＝未公开，不造占位值；inferred 标记推断值）；结果中的 dataVersion 标识数据版本，引用商圈事实时可注明。';

// zod shape 只做基础类型收口；精确约束（整数/上下限/枚举/已知键）在工具回调及 store 层校验，
// 让违规以 isError + invalid_param 结构化信封返回（可被 Agent 自纠错），而非 SDK 协议错误。
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'tradearea_search',
    description: `按条件筛选商圈摘要（分页返回，pageSize 1–100，默认 20）。筛选：province 省级全称、city 城市名、rating 枚举 ${RATINGS.join('/')}、keyword 商圈名或地址包含词、metrics 按原始数值指标过滤 {指标名:{gte?,lte?}}（可用指标 ${METRIC_KEYS.join('/')}，缺该指标值的商圈不入选）。适合先缩小候选再逐家读详情。${DATA_HINT}`,
    readonly: true,
    inputShape: {
      province: z.string().optional(),
      city: z.string().optional(),
      rating: z.string().optional(),
      keyword: z.string().optional(),
      metrics: z.record(z.string(), z.looseObject({ gte: z.number().optional(), lte: z.number().optional() })).optional(),
      page: z.number().optional(),
      pageSize: z.number().optional(),
    },
  },
  {
    name: 'tradearea_detail',
    description: `读取 1–50 家商圈完整档案：12 个分析维度全文（含来源与可信度 A/B）、数值指标（含推断标记）、评级与默认评分。多商圈对比请自行组合多次调用，不设对比工具。${DATA_HINT}`,
    readonly: true,
    inputShape: {
      ids: z.array(z.string()),
    },
  },
  {
    name: 'tradearea_score',
    description: `按自定义权重重算选址评分（四因子：客流/3公里人口/客群匹配/停车便利，权重非负、无需加总 100、内部归一；省略用默认 30/20/15/10）。严格模式：任一权重>0 的因子数据缺失则该商圈 score=null（不做权重分摊）；权重 0 表示刻意排除该因子。本工具只输出分数与因子值，不产出选址结论；结论由你基于档案与口径自行判断并说明。${DATA_HINT}`,
    readonly: true,
    inputShape: {
      ids: z.array(z.string()),
      weights: z.looseObject({ traffic: z.number().optional(), pop: z.number().optional(), crowd: z.number().optional(), parking: z.number().optional() }).describe('提供时须包含且仅包含 traffic/pop/crowd/parking 四个数值；完整性由工具实现返回结构化错误。').optional(),
    },
  },
];

export function createTradeAreaServer(options: { dataRoot: string }) {
  const store = new TradeAreaStore(options.dataRoot);
  const server = new McpServer({ name: 'trade-area-mcp', version: '0.1.0' });
  const handlers: Record<string, (args: unknown) => Promise<unknown>> = {
    tradearea_search: args => store.search(args as never),
    tradearea_detail: args => store.detail((args as { ids?: unknown }).ids),
    tradearea_score: args => store.score(args as never),
  };
  for (const definition of TOOL_DEFINITIONS) {
    server.registerTool(definition.name, {
      description: definition.description,
      // Preserve keys until the implementation can reject them with its envelope;
      // z.object's default stripping would silently bypass precise-key checks.
      inputSchema: z.looseObject(definition.inputShape),
      annotations: { title: definition.name, readOnlyHint: true },
    }, async (args: unknown) => {
      try {
        if (Object.keys(args as object).some(key => !Object.hasOwn(definition.inputShape, key))) throw new ToolError('invalid_param', '参数包含未知字段');
        const payload = await handlers[definition.name](args);
        const result = payload as Record<string, unknown>;
        return {
          structuredContent: result,
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (error) {
        if (error instanceof ToolError) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: JSON.stringify({ error: { code: error.code, message: error.message, detail: error.detail } }) }],
          };
        }
        throw error;
      }
    });
  }
  return { server, store };
}
