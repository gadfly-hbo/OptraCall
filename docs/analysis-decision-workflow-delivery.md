# 分析与决策闭环五项 Git/CI 交付与原位归档

2026-11-11，用户授权单PR、实际head CI通过后直接squash、快进本地main与原位归档，保留WIP/原FAIL/验收证据，不切换服务或更新MacBook。本记录按实际回执填写，代码与文档收尾分别核定。

## 实际Git身份与验证

| 对象 | 实际结果 |
| --- | --- |
| 最新集成基线 | 开始fetch后origin/main与本地main均为`d5ded3b2fa1077dbaad9bfbda9684c42ef7ba198`；main在主checkout占用且干净，开发分支起初无上游。合并前再fetch核base/head，没有额外基线变更。 |
| 五项初始WIP | 113份完成清单SHA `fd96f198d824503c168f2540d73908dadb1ef1346a1e7a89cb5aa836c722422a`；原件副本、Git差异、分支占用与原.local证据完整保留。 |
| 集中PR | [PR #62](https://github.com/gadfly-hbo/OptraCall/pull/62)，单一功能PR，初始head `af004c043e9cfc722c03bf3e8cf93d7d47f8f816`，修复后实际head `938f9b86f72513e9406071312e65b5990ddb49f6`；base至最终120件累计差额。 |
| 历史CI | [Check #162](https://github.com/gadfly-hbo/OptraCall/actions/runs/42998432833)验证初始af004：2091 tests / 1941 PASS / 0 FAIL / 150条件SKIP。该成功不消除后续独立P2，也不当作修复head验证。 |
| 实际PR head CI | [Check #163](https://github.com/gadfly-hbo/OptraCall/actions/runs/43000785366)，event=pull_request / attempt=1 / run=43000785366 / job=130456084825；run、fetch、checkout、git log及构建标识均准确绑定`938f9b86f72513e9406071312e65b5990ddb49f6`。2096 tests / 1946 PASS / 0 FAIL / 150条件SKIP；边界、tsc、Vite及高危级审计门通过。完整job日志SHA `665de267f66e84c8bddb4e72fdabbc521aa02eea66d1e9512e5bed8ca23ffcdf`。 |
| 双轴及专项 | [Spec](analysis-decision-workflow-reviews/spec.md)和[Standards/四原则](analysis-decision-workflow-reviews/standards.md)最终PASS，明确覆盖当前累计范围/修复增量；原初始PASS、P2及FAIL不覆盖。 |
| squash合并 | GitHub回读merged=true，时间`2026-11-11T10:23:21Z`，main合并提交`dbdd96794d66d495e479b94ae27a44f76ccfd8a9`，单父为原main；完整tree与实际受检head均为`49cad8ca3ab019873bfc3aa9db79c4f298c6553f`。PR合成merge SHA未冒作受检head。 |
| 本地main首次快进 | 先核主checkout仍干净、跟踪origin/main，再仅ff到`dbdd96794d66d495e479b94ae27a44f76ccfd8a9`；原其它分支/WIP保持。 |
| main push检查 | [合并后main Check #164](https://github.com/gadfly-hbo/OptraCall/actions/runs/43003206998)单独由event=push触发，准确head为`dbdd96794d66d495e479b94ae27a44f76ccfd8a9`。本归档成稿时该检查状态为`in_progress`；最终结果和后续归档提交自身的main push CI由Actions及本机final-receipt另核。 |

PR审计报告仍有2项moderate，未被写成零漏洞；大于500kB的bundle提示保持。没有为检查通过改SDK版本、依赖锁或扩大边界白名单。67条mac本地与150条初始Linux CI条件SKIP属于各自实际环境，最终head计数以上表为准，不把未执行写成覆盖通过。

## 原始失败与交付修复

五项开发按1→2→4→3→5完成。[各项本地验收与阶段计数](analysis-decision-workflow-baseline.md#五项本地验收汇总)保留原候选身份及FAIL/UNKNOWN/专业边界；最终开发阶段mac完整检查2091/2024PASS/0FAIL/67条件SKIP属于当时受检版本，不用它冒称修复head完整CI。

本次整批交付复核独立发现ST-RCR-01/P2：子会话创建前失败时，fixed-packet-prepared回执被UI误标实际提供。修复仅准备标签/证据限定、两处类型注释及对应测试；正常原生请求与固定包组合证据继续可核，不新增DTO、账本、Runtime或SDK接线。实际0child反例RED→GREEN、normal/partial/legacy/撤权及单委派回归、实际Chrome均通过。新SSR测试的data:加载边界FAIL被保留，最终改用既有固定字面Vite公开入口；白名单未放宽。

Spec当前正式结论由原整批报告与修复补充组成。Standards最初源报告把61次有效执行写成61个不同测试，公开摘要已按现存日志更正为61次/60个不同节点；不改原报告、不补跑凑数。第1/2项此前只有实施记录转录的结论与独立日志，本轮未补造历史签署报告；当前整批正式复核另存原出处及摘要SHA。

首次Git push因旧credential helper路径失效而失败，后用本机已有gh做单次命令适配成功，没有改全局凭据配置。GitHub连接器用于PR/检查任务与日志；它未提供的完整event/head及main push元数据用现有gh只读补齐，未绕过检查。该失败及只读SSH认证探针失败均留本机交付收据，不影响最终Git身份。

## 原位归档及边界

五个原目录各自result标记工程归档，保留spec/Demo/implementation原路径和原字节；正式当前复核摘要进入仓库。原始命令输出、native、清单、P2反例、失败与诊断现场仍在原工作树.local及`.local/analysis-decision-delivery/`，不随公开仓发布、不移除工作树，不删除源分支或长期分支。

本次归档提交仅修改十份Markdown：本记录、总基线、五个result、两个公开复核摘要和其索引；其余源码/测试/配置/SDK blobs必须与受检squash一致。归档提交自身SHA、最终main push CI及最后main快进以Git/Actions和仓外交付`final-receipt.json`核定，不为自引用无限追加文档提交。

工程Git交付/原位归档与安装、运行采用、真实Provider专业效果、经营采用及用户产品验收分别核定。本轮没有运行部署脚本、切换服务或操作MacBook；schema3仅做隔离合成迁移验证，未来采用仍须兼容代码和数据保全。
