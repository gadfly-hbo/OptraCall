# Studio覆盖报告与36格全景：实施目标任务清单

2026-11-13 · 用户已确认v0.3方案／原BC01–BC12＋C01–C10增补／UI Demo v0.2，授权产品开发、Git／CI、合并main、切换Mini服务后停止。目标企业资料和资产建设M阶段仍不启动。本轮没有更新MacBook授权。

批准原件按[身份清单](approved-inputs.json)保持；旧spec／清单中的“待审核、暂不开发”是准备历史，本文件跟进本次已授权实施。基线feature e78d7199与main a4eca5e1同树，fetch后main未前进；现工作树只有本任务未跟踪审核包。主main checkout另有README WIP保留。

| ID | 实施目标 | 可核对完成条件 | 状态 |
| --- | --- | --- | --- |
| I01 | 固定批准输入与实现接缝 | 文件身份、最新main/WIP、职责／SDK／测试接缝及允许路径核定 | 已完成；approved-inputs、下述接缝与复用约定 |
| I02 | 报告内容与来源资格 | 严格有界reportProfile正文；save/preview/publish/catalog/read-source全路径引用闭包，旧内容兼容 | 已完成；后端56项及兼容回归、独立逆例通过，RED与F1修订保留 |
| I03 | 正式36格与准确投影 | 完整主视图、逐格／反查、独立去重、未知／恢复、原工作项接续及390局部滚动 | 已完成；正式React及43项相关回归，实际产品浏览器通过；F2修后同路径回验 |
| I04 | 普通使用与演进历史 | 同企业普通Agent沿原工具发现／精读；候选不可供给，失权不借缓存／新候选恢复；新版本与原历史分开 | 已完成工程验证；真实Host／官方Pi＋本机协议Provider保存/发布/普通查读/r1→r2/重启及旧native字节保留通过；不代表模型质量 |
| I05 | 实际产品验证与独立复核 | 公共接缝TDD、完整npm check、真实Host/Pi合成Provider与准确读源/重开、产品浏览器、四原则及新鲜非作者复核 | 最终全量2294项：2243通过／51跳过／0失败，build及audit high通过；非作者核心及受影响37项通过，最终文稿收尾回读见result |
| I06 | Git／CI／main | 固定审查候选、暂存范围、feature实际head CI、squash合并、main CI及安全快进 | 按Git后[本机执行进度](../../../../.local/studio-business-coverage-implementation/delivery/progress.md)和最终收据核定；不从本Git前快照推断已合并 |
| I07 | Mini服务切换与停止 | 切换前即时busy/保全核定、现有release流程、目标源码/构建/runtime身份及持久数据读回 | 与I06同一执行进度分别记录；保留桌面三个入口，不更新MacBook，资产M仍未启动 |

## 已批准测试接缝与实现范围

依据原BC02／BC05／BC07–09／BC12和C03–C10确定公开seams：business正文保存、发布预览／指纹／确认、企业catalog与普通read-source、按准确报告修订的只读当前资格投影，以及React页面的逐格／资料反查／独立统计和未知恢复。用户批准已有输入涵盖这些接缝，不要求重新逐一确认测试接口。

连续SDD/TDD逐slice写出能揭示目标行为的RED后再GREEN，日志留`.local/studio-business-coverage-implementation/`；测试使用获准合成资料，不是实际企业建设。真实依赖采用现有官方Pi1.4.0、Interface v3和本机协议Provider，不调用真实模型、不改SDK／依赖，不将合成协议输出当模型质量。

实现允许范围：app-owned coverage内容／资格模块，原Studio store/host/source/catalog薄接缝、原Studio基础资产React视图/client、必要兼容与集成测试、本变更实施与采用记录。原foundation/1与/2、SAP0.2、SourceRef、七种资产kind及官方Pi／Semantica原包不改；不新增覆盖主库、Asset Registry、运行时、全局报告指针或格子审批。

Host核格式、准确引用、归属和原资格，提供只读投影与保存；Agent自主收料、标注、核歧义和选择工具。无报告仍可直接普通分析；正常新增必做操作零。原question/gap/review和contribute复用，疑点不自动mark-issue；Binding按计算／执行用途核，合法范围差异并存。

报告投影需经原owner准确读者当前资格，不能从基础页缓存的系统body直接展示失权证据。建设候选的可读资格和普通正式供给分开；输入变化、跨企业／任务、损坏与未知版本保留限制。报告和原任务历史不回写，新候选只新增候选，不恢复旧正式资格。

批准输入中的测试／Demo及原准备清单仍保留字节；本表是实施清单。Git之后CI／合并／运行采用的动态步骤在上述本机私有进度和最终收据更新，不将运行日志、凭据、原生会话或经营数据提交公开仓库。具体实施和检查见[result](result.md)。

## 范围停止线

完成本表I01–I07后停止。企业基础层主数据／指标体系／本体实际收料、盘点、内化、发布和会员运营业务主题均未启动，待用户后续资料与明确通知。Git／工程结果、运行采用、模型专业质量和用户产品验收分别记录，不覆盖旧FAIL／UNKNOWN。
