# Codex 目录接缝任务书（data-analysis skill）

本变更唯一 Host 接缝，归 Codex 实施（Qoder 移交，形态对齐 ppt-report / target-forecast / deep-research 先例，测评卡按 [统一展示规范](../../../../docs/skill-evaluation-display.md) 默认收起、回执绑定被测版本）：

1. `src/host/ui/catalog-data.ts`：`CatalogEntry` 追加 `'data-analysis'`；新增 `dataAnalysisEvaluation: SkillEvaluation` 常量与"已接入"条目（建议文案与数据见下）。
2. `src/host/ui/App.tsx` `openCatalogEntry`：该条目导航到项目视图，对齐既有分支。
3. 完成适用检查（含浏览器点验：条目可见、测评卡默认收起可展开、点击进项目看板），非作者复核覆盖本接缝后按 Git/CI 授权交付。

## 测评卡数据建议（出处：用户回执 2026-11-06，归档 1.9.0）

```ts
const dataAnalysisEvaluation: SkillEvaluation = {
  date: '2026-11-06', testedRevision: '6df72f4（评估归档 1.9.0）', revisedSinceEvaluation: false,
  outcome: 'effective', sampleCount: 15,
  assertions: { basis: '条目累计', baseline: 26.8, variant: 87.4 },
  activation: { activated: 15, total: 15 },
  judgments: { wins: 11, ties: 3, losses: 0, undetermined: 1 },
  seconds: { baseline: 25.2, variant: 109.7 },
  tokens: { baseline: 7_048, variant: 282_738 },
};
```

说明：被测内容 hash `63adebba`＝`6df72f4` 的 SKILL.md 字节，skill 未再修改故 `revisedSinceEvaluation: false`；verdict 为 effective（评估报告标注"有效但昂贵·provisional"，成本 40.1x token 如实呈现，不粉饰）。

## 条目文案建议

```ts
{ id: 'data-analysis', category: 'assets', skill: { evaluation: dataAnalysisEvaluation }, name: '运营数据分析', description: '内置分析 skill，随 OptraCall 更新。在项目任务对话中对业务数据做趋势对比、异常定位与指标拆解归因，六段式报告经格式门禁与数据体检，数字可复算。', tags: ['数据分析', '归因'], source: 'OptraCall 分析资产 · data-analysis skill', note: '使用入口＝项目任务对话，提出分析数据/看趋势/找异常类问题，最终报告落 060_reports。脚本需 python3（纯标准库）。不做目标测算、发券、投放与公开信息深度研究（对应各自 skill）。评估实测成本较高（token 约 40 倍于不装 skill），长任务请留意。', status: '已接入', entry: 'data-analysis' }
```

## 复核导引（非作者复核任务书要点）

- 先从 spec.md 的 DA1–DA9 与验收 DA01–DA10 独立导出预期，再核对实现与作者测试；源文件只读。
- 重点：B 模式零复制声明（skill 全部内容与第三方无文本/代码/数据重合，抽查比对）；双脚本 selftest 独立复跑（calc 21 项、quality_check 17 项含对抗）；样例报告数字与脚本输出一致；SKILL.md 与四个既有 skill 的激活分工不重叠；quality_check 判据（R1–R5/DA1–DA5）与 [skill-evaluation-display.md] 及 SKILL 表述同源不冲突；目录约定（020/060/010）与产品系统提示一致。
- 复核上下文独立、不继承作者会话；发现经根修复后由原复核者复验。
