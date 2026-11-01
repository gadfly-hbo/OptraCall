# 反馈闭环A：实施与验证

2026-10-31。A已实施，适用检查与非作者复核完成；保留原决策看板。B/C未开发。当前为 `codex/decision-feedback-loop` 的未提交工作树候选，基线／HEAD `b36a42b`；不是Git／CI交付、部署或用户产品验收。

## 已实现的闭环

1. 原看板的抽取、筛选、人工建议、采纳／驳回、行动任务、统计保留。执行中、未执行、无明确反馈均可进入普通复盘；反馈更新追加修订，评分选填、效果可未知。历史可读，可明确选择旧版，同版可多次交接。
2. 用户预览问题、反馈修订、一个Case或无Case、报告／事后资料及全文／片段／仅引用，确认后只建原项目普通任务草稿，不调用模型。取消全部材料仍可正常提问。
3. 显式发送沿原 `project-tasks`／Interface v1；Host只装配本次选择、校验真实归属与技术身份、保存提供回执。Agent的普通工具、方法选择及执行自由保持。无Host经营补算、固定方法库、必填分析步骤或自动核算兜底。
4. 用户可明确选择实际原生回复或060报告形成原需求模块的未确认草稿，保留所选正文／片段及真实来源，背景可编辑，不自动写facts、确认或发布RAP。
5. 报告关联、采用副本、编辑Case判断是原Case的独立显式操作。所选报告可再进入同一交接表单，创建下一轮普通分析。Case关联不代表下轮已提供／已读，旧经验可不适用。

RAP／SAP／企业资料各留原权威，本期不自动发布经验或改旧版本。复盘仍用原项目＋task owner；需求仍用原instanceId／profile、空工具默认，Board抽取仍用原独立owner，无新Runtime或第二会话生命周期。

## 数据与兼容

- Board schema1→2事务追加反馈修订；原五表DDL和既有行保留，旧反馈只形成首个已知版本，不编造覆盖前历史。新评分null，是否执行必须明确boolean。新写入需operationId＋expectedLatestRevisionId，无意图的旧写请求提示升级；读路径保留。旧代码不得向schema2降级写入。
- 新 `dataRoot/decision-feedback/` 只存交接／业务意图／实际提供记录；普通020文件明确可变。固定正文、原抽取片段和当前路径观察分别记录；UTF-8严格解码、范围显式、不静默摘要或截断。全文SHA核实际预览内容，原生回复也核真实session／message身份及全文SHA。
- 创建前预定稳定目标；丢回包先查原意图，逐项显示未知／部分成功，显式恢复同一身份，不另建任务、不覆盖后来草稿、不删除产物补偿。需求整目录先在枚举外准备，再在排他写者／计划身份锁内发布；中断不污染旧需求列表。
- 原交接Case版本作为历史保持；后续另存资料／创建需求各自明确一个当前Case版本或无Case，加入本动作意图。用户先更新Case再做后续动作不会卡在历史版本，也不静默换新版本。
- 死writer锁在排他恢复claim内核pid／token／inode／bytes后恢复环境资格，不重放未完成业务。未知／损坏的锁或记录保留并明确拒绝；不以自动清库或回填旧备份恢复。
- 未对真实现有项目库执行升级或遍历改写。旧库／会话保全在隔离fixture验证：旧表值、原draft、native JSONL路径／字节／父链及文件保留。运行采用时的真实库迁移仍是另一个验收范围。

结构依据：[七项已确认决定](structure-decisions.md)。本动作Case选择是第2／4／6项逻辑组在独立后续意图上的落实；原交接不追改。

## 工程检查与独立复核

本机证据根：`.local/decision-feedback-loop/`，仅合成隔离数据。

| 候选／检查 | 实际结果及边界 |
| --- | --- |
| main基线 | `npm run check` 543/543，边界、类型与构建通过。 |
| 首轮联合检查 | 559中558通过，旧crashed Host恢复被新feature锁阻断；原FAIL日志保留，随后修复并验证旧生命周期。 |
| 第一源码冻结 | 566/566及类型／构建通过；后续独立复核发现Case推进后动作资格卡旧版，不能拿此通过代替最终候选。 |
| 第二冻结／最终功能候选 | `final-source-manifest-2.json`，34文件，清单SHA `6193102c678572b217b1758b4bb1c4e390af506163910cbb6a362039ca819783`；`final-check-2.log`：568/568、0fail／skip，boundary、types、Vite／stamp全部通过，进程退出0。 |
| 最终文案增量 | 仅一UI文件把“Case准入”改成用户可理解的“本次资料对应／需求参考的Case”，无字段或逻辑改变。`final-source-manifest-3.json`，34文件，清单SHA `cb2547ba527e7307ba98fa33f6ab838a4e3d970dad70826642eca386bcfd8d25`；`final-build-copy.log` 类型／构建退出0，diff-check通过。568全测对应上一功能候选，未声称文案后重跑全部。 |
| 非作者独立复核 | 新鲜上下文对规范／spec两轴审查，另有独立规范复核；独立定向29/29，并独立复现／复验双进程锁竞争及Case后续动作。无未关闭阻塞；最终文案按增量另核。报告见下。 |

Vite有大于500kB的chunk提示，构建成功；不是性能验收。CI、提交、PR／合并均未执行。

独立报告：`.local/decision-feedback-loop/review/implementation-independent.md`，最终SHA256 `23b7e90fe659f0d6b05a08ceac76c5551e0c72ee13a2067a38e0dd12cd8c490f`。原发现／原FAIL保留，包含迁移失败回滚、需求半发布、死锁回收竞争、来源变更与同原生ID正文改动、CAS冲突、UNKNOWN／确定拒绝恢复、同反馈多交接、Case归档／原回执以及Case更新后的后续动作。

## 实际UI点验

使用CUA真实浏览器与隔离Host／原生SDK，Provider是明确的固定合成协议，不能冒称真实模型分析。原型的内存模拟不用于证明本节。

- 预最终候选：旧v1且已有v2→明确CaseA→创建未发送草稿→显式发送→选实际回复创建需求→固定来源回读；明确保存报告→只关联Case（未采用／未改判断）→选报告与CaseB创建下一轮→取消全部→零材料普通发送。原看板和两个普通任务保留。
- 最终功能候选重新启动独立测试Host后：v2／CaseA v2→未发送草稿→显式SDK发送→独立编辑判断到Case v3→同一原生回复全文SHA／本动作明确无Case→需求创建成功，背景为可读正文，未确认／未发布；同版“另一次复盘”Case清空而原交接保留。
- 390×844深色反馈页 `document.scrollWidth=innerWidth=390`；亮／暗均点验，临时viewport已复原。对话框键盘激活及原生焦点／关闭路径检查；控制台warn／error为空。不是全面WCAG或物理手机验收。
- 一次Case控件label定位未匹配后按实际DOM combobox定位；聊天区指针点击受滚动布局时机影响未触发，改用已显示按钮的键盘激活后走通，未修改业务数据绕过UI，也未据此宣称全部指针行为已覆盖。

截图：`acceptance/product-board-final.png`、`product-review-final.png`、`product-requirement-source-final.png`、`product-review-mobile-dark-final.png`；最终DOM `product-final-dom.txt`。测试Host均独立，未切原运行服务。

## 两轮真实模型及限制

按已通过spec的合成验收计划，用本机现有MiMo V2.6 Flash配置，经原保存入口配置到独立Host。仅有合成资料，无预算上限、无模型fallback，不复制真实项目／会话或经营数据。源settings/auth前后SHA一致，未输出凭据。模型工程现场与报告保留在测试运行目录；索引：`acceptance/live-1793450238454/result.json`。

1. 第一轮普通Agent自行读取两店事后CSV、使用read／bash／Python并写复盘报告。原任务 `98983e6c-33a4-495d-830e-94e4d3c50062`，请求 `deb620b0-931f-456c-8d5d-e05938f194cb`，completed。报告9078 bytes，SHA `4300c6b11e8b260ffeb9f6adf59a09a7769188f192362697858b522d86a18cd0`。
2. 从其明确回复建未确认需求，显式关联报告到CaseA；选该报告全文和不同条件CSV引用，创建CaseB的新普通任务。第二轮自行读取／计算并写新报告，明确旧会员召回动作不直接适用旅游新店。任务 `26552eeb-b78e-44c0-95e7-781dadffa06d`，请求 `9ec92ea1-bf16-44dd-8606-8c5d39e50f9b`，completed。新报告11021 bytes，SHA `7524d5fb4d37e42f7ef0af2cb732451c6c4c4de8762f7dc38e3bba47b9978c49`。

原验收脚本末尾误用了不存在的 `/api/requirements/instances/...`，故原总结果仍保留 **FAIL_OR_UNKNOWN**；两轮模型和报告此前均已完成。纠正为原 `/api/requirement-instances/...` 后，仅重启隔离Host回读原任务／需求／来源／Case，**未重放模型**。`readback-result.json` 记录 `TECHNICAL_CHAIN_READBACK_COMPLETED`，原CSV及两个native JSONL摘要不变。真实运行发生在功能收尾期间，不把后加的故障修复都冒称在这两轮模型里重新验证；最终合同另由568项检查、独立复核及新鲜UI覆盖。

**专业质量仍有错误，不能给整份报告PASS。** 第一轮Agent自建脚本的样本量函数系数16，与其同脚本MDE近似反推的系数2不一致，相差8倍；报告沿用了约25万样本量。分母前后相同也被过度推断成“不可能／很可能占位”，虽资料已明确合成。第二轮未照搬旧动作，但不等于已纠正第一轮所有数值。这些原报告／脚本／输出保留，Host未补算、未替换报告、未自动再核算；按用户要求留待B/C推进。

## 交付边界

A的人工反馈回流技术闭环已补齐；原看板与普通分析保留。未自动经营取数／触达／执行、未更新企业资料或发布RAP。真实模型completed、反馈评分、任务状态和工程检查均不代替专业结论可靠性或经营效果验证。

现有运行服务、真实项目／会话／文件及MacBook未切换或清理。Git／CI交付、合并main、运行采用、用户产品验收均未在本次自动执行。
