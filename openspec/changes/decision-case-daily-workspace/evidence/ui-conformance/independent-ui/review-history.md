# 独立复核失败与候选退役记录

以下记录原失败及其后关闭证据，不修改原 FAIL。最终候选 g 仅在 [完整 62 行矩阵](final-review.md) 所列范围通过；T15 固定 g 的完整检查原回执已核为 PASS；T16/17/18 工程交付、用户确认仍待执行。本复核者未修改生产、永久测试、spec、Demo、规范，未执行 Git/Issue/PR。

| 候选/发现 | 原失败直接证据 | 后续状态及边界 |
| --- | --- | --- |
| 初查 | [原冻结验收矩阵](acceptance-matrix.md)；正式 Case 详情仍是 modal 加纵向管理，而冻结是常驻页头、左事项右当前工作。 | 主结构重做；e 实际页面及 g 受影响交互通过，见最终矩阵。 |
| a / B01 | [真实创建后再准备回执](candidate-a/product-preparation-result.json)、[G/S 与 scope 消失原图](candidate-a/product-prepare-another.png)。 | f 隔离真实创建后再次准备，G/S 与 scope 各 1：[实际回执](candidate-f/product-preparation-result.json)、[恢复图](candidate-f/product-prepare-another.png)。g 准备代码未变。 |
| a / B02/B06 | [旧总览](candidate-a/product-overview-1440.png)、[同次当前第2轮](candidate-a/product-current-list-1440.png)、[旧首页](candidate-a/product-home-1440.png)。 | g [加载完成总览](candidate-g/product-overview-settled-1440.png) 与准确第2轮；[首页准确请求归属](candidate-g/product-home-modals.json)。e 有一张总览加载态仍保留，未用它证明准确内容。 |
| a / B03–05 | [原树](candidate-a/product-current-tree-1440.png)→[返回变列表](candidate-a/product-current-back-1440.png)；[旧历史管理页](candidate-a/product-case-history-1440.png)；[旧项目卡片](candidate-a/product-case-projects-1440.png)。 | 真实页替换、树保留，最终矩阵有页面图及 g [实际交互](candidate-g/product-interactions-b.json)、[历史只读/返回](candidate-g/product-history-b.json)。 |
| a / B07–10 | [缺原项目返回](candidate-a/product-project-to-case-return.png)、[旧成果源](candidate-a/product-artifact-source.png)、[390 树压缩正文](candidate-a/product-tree-expanded-390.png)、[取舍无 modal](candidate-a/product-choice-entry-1440.json)、[反馈无 modal](candidate-a/product-feedback-entry-1440.json)。 | g [scope/来源/项目返回](candidate-g/product-interactions-b.json)、[三个视口实际 modal](candidate-g/product-home-modals.json)；e 39 页图及 g 焦点复验通过。 |
| b / B11 | [403/503 真实网络注入 FAIL](candidate-b/product-failures-b-recheck.json)、[403 原图](candidate-b/product-artifact-injected-403-b.png)、[503 原图](candidate-b/product-artifact-injected-503-b.png)。 | f [403/503/409 与只读恢复](candidate-f/product-failures-settled.json) 通过；g 原文件读取/分类代码未改，来源 popup 再跑通过。网络注入不冒称自然后端撤权。 |
| 反馈请求隔离 | [独立同任务 A→B 原错误请求草稿](boundary/feedback-request-switch-result.json)。 | 请求 scoped draft key 后，正常/UNKNOWN 独立 [原回检](boundary/feedback-request-switch-recheck-result.json)；g 58 组件合同再次通过。 |
| c / B2、B3 | 另一非作者 backend 报告改选 v2 全重开恢复 v1、关闭 Case 初始化 draft PUT；本复核者没有冒称原故障由本人复现。[当时边界复核明确未关闭 B2](boundary/candidate-c-boundary.md)。 | g [58 项组件回归](candidate-g/independent-ui-contracts.log) 独立验证 B2 plan/unlink 全重开及 B3 closed Case 只读；更广 backend 回执由 PM 独立发布。 |
| d / D14 | [原实跑 receipt](intermediate-d14/receipt.json)、[1440 原图](intermediate-d14/feedback-1440.png)、[390 原图](intermediate-d14/feedback-390.png)：Board 长表单 620×952，内容高1032，保存需滚动，缺日期/来源范围。 | e compact 三字段及真实 v7 保存；f 新进程 [精确回读](candidate-f/raw-readback.json)，g [modal 三视口](candidate-g/product-home-modals.json)。约530×662，比冻结约530×598多两个必要折叠入口，默认保存无需滚动。 |
| e / 首页 choice 焦点 | e 原修复过程由 PM 保留；f 只补 CaseDialog/Panel 明确返回焦点；本主审不冒称 PM 的原 e 重现是自己的。 | g 两次精确 choose 入口及取消回按钮：[回执](candidate-g/product-home-modals.json)。 |
| f / observe 焦点 | [真实 SPA 原失败](candidate-f/feedback-focus-repro.json)、[第二次取消 BODY 原图](candidate-f/feedback-focus-attempt-2.png)：1440→1024→390→1440、来源展开/收起、重复进入观察，第二/三次等待3秒仍 BODY，业务写零。 | g 用同一独立脚本仅改输出目录：[连续三次通过](candidate-g/feedback-focus-repro.json)；完整首页两类入口另跑通过。透传原 returnFocusId，无新业务写。 |

探针问题与产品问题分开保留。e 真实原观察已经保存成功，但探针错误断言顶层 authorizationId（实际位于 respondsToRequest 内），故 [原过程回执](candidate-e/product-raw-observation.json) 保留失败；随后只读 [原反馈](candidate-e/raw-after-readonly.json) 与 f 新进程回读精确核验，没有为修断言重放保存。e 首次 7 项集成并发时 Pi 启动超过原 10 秒界限：[原日志](candidate-e/independent-real-integration.log)；未改源码/测试，f 降并发同 7 项 [重跑通过](candidate-f/independent-real-integration.log)。g 完整 modal probe 在 4 次首页入口已经通过后误用上层 workspace tab 当返回卡片按钮，超时及 [原因](candidate-g/home-probe-first/cause.txt)、[原回执](candidate-g/home-probe-first/product-home-modals.json) 保留；仅修 probe 使用准确“← 返回 Case 总览”，最终通过。主 fixture c 临时理由/下一步已恢复为空，[恢复回执](candidate-c/choice-draft-restored.json)。

旧完整 Board 原本要求明确 yes/no；没有日期时 unknown 禁保存不是新增回归。Case compact 新增带日期原观察；旧布尔保存/旧草稿和原完整模式合同保留。当前 keyed IssueWork/FeedbackForm 路径通过，通用未 keyed hook 原地换 owner 的合成风险另记在最终报告，未抹去也未冒称当前产品可达。

T18 的真实截图用户明确确认尚未取得。工程和独立复核通过不能替代开 PR 前这项前置条件。
