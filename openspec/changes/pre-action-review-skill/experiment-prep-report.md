# 行动前审查最小实验包 · 准备与冻结交付说明

日期：2026-11-09 · 基准提交 `94db923`（proposal.md v0.2.1）。本次授权覆盖材料准备、最小实验版编写、独立审阅、离线校验与冻结。完成后停止，不跑对照、不执行真实业务动作、不调用真实 Provider。

## 实验包路径

`​.local/pre-action-review-experiment/`（gitignored 受控本地目录）

```
.local/pre-action-review-experiment/
├── skill/SKILL.md                          # 最小实验版 Skill（唯一文件）
├── private-criteria/criteria-framework.md   # 逐案判据框架（空白待填，不进 Agent 可读路径）
└── freeze/
    ├── run-config.md                        # 运行配置（模型/SDK/工具/上下文/隔离设置）
    └── freeze-manifest.md                   # 冻结清单与逐文件 SHA-256
```

## 四案覆盖摘要

| 案 | 设计情形 | 状态 | 原因 |
| --- | --- | --- | --- |
| A | 关键证据缺口的高影响行动提案 | **缺项** | 本机全部 OptraCallProjects 为合成测试数据（SIMULATION_BRIEF 标注"纯合成资料"），无真实业务提案与授权记录 |
| B | 拟行动超出已批准范围 | **缺项** | 同上 |
| C | 证据充分且已获明确批准 | **缺项** | 同上 |
| D | 低风险明确交办 | **缺项** | 同上 |

**不得用合成提案补足后声称四案已齐。** 四份真实提案须由用户提供或另行授权获取。

## 最小实验版 Skill

单文件 `SKILL.md`，遵循产品四原则：
- **不审批不拦截不绕权限**——只建议（三档用语）
- **Agent 自主**——自选审查重点/方法/工具，报错可换法，只降级受影响项
- **复用现有 Pi 与工具**——不新增依赖，不指定必用函数或调用顺序
- **减少人类操作**——优先自核，只有一个聚焦问题时才问用户

正文不含任何历史案例数字（离线检查 PASS）。

## 独立审阅记录

判据框架已准备（`private-criteria/criteria-framework.md`），含逐案五项填写规则（原行动/关键事实及出处/可推进范围/应暂缓部分/增量发现认定标准）。因四案均缺项，判据框架为空白待填状态——须在获得真实提案后由未参与编写的独立审阅者逐案填写并冻结。

## 离线校验结果

| 检查项 | 结果 |
| --- | --- |
| 实验版 Skill frontmatter 格式合规 | PASS |
| 实验版不在日常 Skill 目录 | PASS |
| 判据目录不在 Agent 可发现路径 | PASS |
| Skill 正文不含历史案例数字 | PASS |
| 既有产品测试回归（protected-skills 7/7） | PASS |
| SDK 加载验证 | **未执行**（属运行阶段；frontmatter 合规为代理项） |

## 冻结清单

| 文件 | SHA-256 |
| --- | --- |
| skill/SKILL.md | `a7aba1c81e5f700960a0d5c777b8982c4587a28329bcad51806693775e46e5dc` |
| private-criteria/criteria-framework.md | `9a8acb2a0411497848396ed243e1536943ad9587a9077094539dbf79ee60214f` |
| freeze/run-config.md | `32296b9dd133c067ce5c7c9df798222d97766d28066a03e3143a3c900d9b0b7e` |

**整包 SHA-256：`2114bb97557811f0e620eab3d9d30c4d68e11b5f163e4f93383a2a4162d677e6`**

四份提案均缺项，不记哈希。判据框架冻结但内容为空白待填。

## 仍待确认的事项

1. **四份真实提案来源**——需用户提供或另行授权获取符合 A/B/C/D 条件的真实业务提案与授权记录。
2. **独立审阅者**——需在获得真实提案后由未参与编写的人员逐案填写判据并冻结。
3. **SDK 加载验证**——须在运行阶段通过 `additionalSkillPaths` 从产品入口实测。
4. **两侧执行授权**——冻结包不含执行授权，未来跑对照须另行获准。

## 不具备开跑条件

四案均缺项、判据空白、SDK 加载未验证——**当前不具备开跑条件**，不能写成"已具备"。

---

## 项目暂停确认（2026-11-09）

**当前阶段**：材料收集。项目暂停在此阶段，等待四类真实案例。

**暂停原因**：当前环境只有合成资料，缺少 A/B/C/D 四类可核验的真实案例和授权记录。

**已冻结内容**（保留不动）：
- 最小实验版 Skill（`.local/pre-action-review-experiment/skill/SKILL.md`，SHA-256 `a7aba1c8…e5dc`）
- 运行配置（`.local/pre-action-review-experiment/freeze/run-config.md`，SHA-256 `32296b9d…0b7e`）
- 判据框架空白模板（`.local/pre-action-review-experiment/private-criteria/criteria-framework.md`，SHA-256 `9a8acb2a…214f`）
- 整包 SHA-256 `2114bb97…677e6`

**案例填写模板**（在冻结包外）：
MacBook `/Users/huangbo/Dev/Projects/skill-eval/.local/pre-action-review-case-intake/CASE-TEMPLATE.md`

用户遇到合适真实案例时复制一份，保留原提案/交办、当时的行动建议、关键材料和授权记录。四类各需一份：
- A 关键证据缺口
- B 超出授权范围
- C 证据充分且已批准
- D 低风险明确交办

缺项如实标注，不用合成材料补齐。

**恢复条件**（全部满足才恢复）：
1. 四类真实案例齐备且材料可核验
2. 收到用户明确恢复指令

**恢复后动作**（材料收齐≠自动启动）：
1. 独立审阅者预写逐案判据
2. 离线校验
3. 另存新的完整冻结包
4. 真实对照另行授权

**保留不动**：现有冻结包、`bda5f47` 的「无效」结案、全部历史评测记录、决策方法资产。
