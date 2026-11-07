# decision-review 决策审视 skill · 实施与验证记录

日期：2026-11-07 · 分支：`qoder/ext-skills`（基线 `8099847`）· 状态：Qoder 本地实施与检查完成，处于 skill 测评门禁（等用户回执）；测评通过前不写 Codex 接缝任务书。

## 承接方式

首方原创：依据用户提供的[产品讨论稿 v0.1](../../../docs/OptraCall_决策方法资产与Decision_Review_Skill_产品讨论稿_v0.1.md)（已归档 docs/）原创撰写，无第三方内容承接。用户确认的三项实施决定（2026-11-07）：落位 `extensions/analysis-assets/decision-review/`；**Case 联动方案甲**（决策说明＝060_reports Markdown，复用既有 Case/决策板文件引用合同，状态仅模板文字标注，零持久化/零新字段）；零 scripts、零 subagent 角色。

## 实施范围（实际交付物）

```
extensions/analysis-assets/decision-review/
├── SKILL.md                 # 触发/不触发边界、方法选择表、证据纪律（六类）、决策纪律（5条）、输出分级、自检、资源索引、边界
├── references/
│   ├── decision-theory-primer.md                  # 10 方法总览（定位/用法/适用/局限）
│   ├── toc-tp-usage.md                            # 约束聚焦/因果检查/冲突化解/副作用检查四动作
│   ├── evidence-and-causality.md                  # 证据分级、反证与证伪、相关≠因果≠干预、经验适用性
│   ├── decision-analysis.md                       # 选项表/后果表/定性比较、移交量化边界
│   ├── uncertainty-and-bounded-rationality.md     # 风险vs不确定性、情景表达、停止条件、信息价值
│   └── decision-quality-checklist.md              # DQ 六维自检
├── templates/decision-brief.md                    # 状态行+八模块完整版+轻量版+填写纪律
└── examples/
    ├── coupon-decision-example.md                 # 正例：条件式建议+试行买信息+价值取舍请用户确认
    └── insufficient-evidence-example.md           # 反例：证据不足诚实未决+获取计划
```

另：`tests/protected-skills.test.ts` 追加 DRV01（发现、无 agents、角色集不变、快照 10 文件逐字节）；新建 `tests/decision-review-skill.test.ts`（DRV04 合成端到端：读 SKILL＋模板 → 决策说明含状态行落 `060_reports`）；讨论稿归档 `docs/`。零 Host/Agent 代码、零依赖、零锁文件变化。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| `node --test tests/protected-skills.test.ts tests/decision-review-skill.test.ts` | 8/8 PASS（含 DRV01、DRV04 及既有 6 项；DR01/DA01 的角色集断言在加入本 skill 后仍不变） |
| DRV04 合成端到端（真实 SDK 路径） | PASS：首请求可见 decision-review skill；Agent 读 SKILL.md 与模板（断言模板含状态行约定）→ 决策说明（`状态：ready_for_review`、假设与未知、条件式建议、"建议不等于已决定"、重新考虑条件）落 `060_reports` |
| `npm run check` 全量 | exit 0：1647 项＝1617 PASS / 0 FAIL / 30 条件 SKIP + 边界 + tsc + 构建 |

## 如实保留的边界与未验证项

- 合成路由只证明发现/读取/落盘与状态行约定，不证明真实模型的审视质量、方法组合恰当性与激活率——归用户测评（讨论稿 8.2 十维度、8.3 案例集可作测评输入）。
- 方案甲的局限如实保留：状态为文字标注，界面不可筛选/统计/提醒；Case 关联靠既有文件引用，浏览器级走查归 Codex 接缝阶段（同 TF12 处理）。
- TOC/TP 等参考为原创轻量指导（仓库无既有 TOC/TP 资产），非框架全文；`option-analysis`／`risk-uncertainty-analysis` 拆分与方案乙（Case 轻量字段）按使用反馈另立项。
- 示例中的数字为演示值（已在文件内标注），正式使用须出自脚本输出。

## 下一步

**skill 测评门禁**：同步 MacBook `/Users/huangbo/Dev/Projects/skill-eval/pending/decision-review/` 后请用户按自有流程测评；不通过给优化建议→修复→重测循环；显式通过后才写 Codex 接缝任务书（catalog 文案＋测评卡绑定＋候选清单＋复核导引），转交后本轮停写。
