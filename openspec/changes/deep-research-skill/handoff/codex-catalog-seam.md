# Codex 目录接缝任务书（deep-research skill）

本变更唯一 Host 接缝，归 Codex 实施（Qoder 移交，形态对齐 ppt-report / target-forecast 先例）：

1. `src/host/ui/catalog-data.ts`：`CatalogEntry` 类型追加 `'deep-research'`；"分析资产"新增一条"已接入"条目（建议文案见下）。
2. `src/host/ui/App.tsx` `openCatalogEntry`：该条目导航到项目视图（使用入口＝项目任务对话），对齐 `ppt-report` 等先例分支。
3. 完成适用检查（含浏览器点验条目可见与点击导航），非作者复核覆盖本接缝后按 Git/CI 授权交付。

## 条目文案建议

```ts
{ id: 'deep-research', category: 'assets', name: '深度研究', description: '内置分析 skill，随 OptraCall 更新。在项目任务对话中使用。多源深度研究与大研究报告：原生联网检索取真实来源、章节化研究、独立审稿与最终组装，可并行或链式委派调研员/审稿人子角色。', tags: ['深度研究', '研究报告'], source: 'OptraCall 分析资产 · deep-research skill', note: '无需安装 skill：随产品分发，版本随 OptraCall 更新。使用入口＝项目任务对话，直接提出深度调研/行业研究/竞品分析类问题；Agent 按需检索、委派子角色并产出带来源引用的报告（060_reports）。检索能力取决于当前模型配置路线（MiniMax M3/M3.1-Flash、MiMo v2.6 系列带原生联网；DeepSeek flash 路线未接通，Agent 会如实声明并降级为用户提供资料综述）。报告由 AI 生成，重要决策请人工核验。', status: '已接入', entry: 'deep-research' }
```

说明：note 中如实区分"有/无检索路线"（依据 f174ebb 回执），不承诺所有模型可检索；不写"自动触发"，使用入口与既有 skill 条目一致＝项目任务对话。

## 复核导引（非作者复核任务书要点）

- 先从 spec.md 的 DR1–DR9、验收 DR01–DR07 独立导出预期，再核对实现与作者测试；源文件只读。
- 重点：引用红线与回执规则是否与 [native-search.ts](../../../src/agent/native-search.ts) 实际行为一致（回执块文案逐字对应）；无检索路线降级指引是否与 Host guidance 矛盾；角色文件是否符合 [subagent.ts](../../../src/agent/subagent.ts) 发现契约（name/description/tools、无 model/cwd/agentDir、真实文件）；委派用法示例与工具 schema（三形态互斥、1–8 项、{previous}）是否一致；"质量目标非硬门禁"的降格是否被如实记录而非削弱原插件纪律；报告结构与免责声明完整性。
- 复核上下文独立、不继承本会话；发现经根修复后由原复核者复验受影响范围。
