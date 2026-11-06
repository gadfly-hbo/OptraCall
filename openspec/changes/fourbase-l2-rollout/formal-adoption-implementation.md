# D17正式采用准备实施记录

2026-11-06 · D17.1–D17.9全部推荐A已整体确认 · 仅A–C

## 授权与固定基础

本轮允许必要开发、私有依赖准备、隔离合成验证、非作者复核及Git／实际候选CI固定交付。正式业务根写入、现有服务停启／切换、MacBook及真实模型均未进入本轮。专业可靠性与V404／V405继续单列，旧FAIL／UNKNOWN／NOT_PROVEN不重评。

批准原件、原工作树1023件文件身份和tracked patch保存在原工作树`.local/fourbase-l2-formal-adoption/run-20261106T084708Z/`。原树HEAD `2b9800bc…`及WIP保留；在独立`fourbase-l2-adoption`工作树／`codex/fourbase-l2-adoption`分支基于本次fetch的`main=695b9f10…`整合本任务文件，不覆盖当前main的新功能。

原108件任务新增文件及18件tracked差额已三方整合。5处文件冲突按当前main与L2职责合并：保留模型包字段与更强SDK边界；复用当前main的公开ToolContextAdapter为图工具约束当前调用，弃用旧候选的SDK-owned definition.execute原位改写。官方Pi保持1.4.0，不改安装包或私有fork。此差额与新D17接线一起接受本轮检查，不冒用D16的旧SHA。

## 接口、职责与测试接缝

沿Pi1.4.0／Interface v3及原`project-tasks`，owner为实际projectId＋taskId／request。Host只提供配置、绑定、来源准入与生命周期；Agent自主选择语义／计算工具并复用结果，人的经营取舍不变。已确认D17的公共验证接缝为：原launcher／Host启动与health、项目／任务语义工具、原Store发布／冻结与显式续办、原stop／close／重开。测试仅模拟Provider边界，实际Host／Pi／Store／Semantica继续使用原实现。

| 切片 | 实施差额与已执行验证 |
| --- | --- |
| 正式启动 | 原launcher透传显式配置；否则只取已确定dataRoot下单一`semantic-graph.json`，不存在则旧L1。配置是唯一权威，停启不另存第二份配置。原入口16项、配置／实际Host16项及类型检查已过，真实RED日志保留 |
| 绑定与身份 | 配置严格检查／启动冻结，按明确项目投影给真实任务，未知项目无绑定；disabled不启动L2解释器。health只新增已接受配置hash／资产身份摘要，不称图或业务ready；原无配置响应兼容 |
| 非空资产 | 沿原Store的有限维护入口，共享原物化调用并保留trial空库guard；准确hash复用、冲突前置拒绝、部分成功携原操作身份显式续办，撤回来源不自动恢复。9项公共行为检查通过，默认CI临时目录无需启用开关 |
| 串联验证 | 新公开SC-01S源→非空合成库→目标真实Ref→原build_scene新图→正式Host入口→已有／新普通任务／原Feedback新复盘任务→重启→graph-off。真实119节点／106边图经实际Pi工具返回；8次localhost模拟续轮，真实模型0；原项目报告和原native保持 |

上述组合首次失败为测试准备遗漏既有builder要求的inputs目录，补齐准备目录后通过；不是产品RED。原S5测试不再依赖丢失的`.local` SAP文件：用相同解析器核对，重置该测试本来就重置的fingerprint后，公开SAP与旧发布夹具完全相同，改用仓库内公开源，未削弱断言。

Python全检首次65项中6个准备错误来自旧夹具绝对位置／遗漏原S3环境变量；已让两份原测试接受现有明确authority根，补齐原变量后重验，旧日志保留。不为此创建新的夹具生成／调度平台。全量结果按下节最终回执补记。

## 私有运行依赖与源资产

Node依赖在新工作树按原lock执行`npm ci --ignore-scripts`，未升级Pi／Node或自动audit fix。L2另建专用Python3.12.14／Semantica0.7.0：`/Users/bendandebaba/.local/share/optracall/runtime/semantic/py3.12.14-sem0.7.0-2fe580f56791/venv/bin/python`，不替换普通分析Python，不迁移旧venv。

[平台固定锁文件](../../../scripts/fourbase_l2/requirements-semantic-py312-macos-arm64.lock)的70 pins／wheel hashes包含69运行依赖＋pip，SHA `2fe580f56791ba06b1a40ac7b8d30dededc43a53d7c8f3b4df8587070977db00`。私有base独立于Codex缓存；原普通文件复制后身份相同，3个失效文档／pkgconfig别名只在新副本改成相对链接。新venv标准重装官方同版本pip，未手改源码；70个wheel的10643个普通文件与实际安装字节一致，344个原生库未依赖旧缓存／D16路径，pip check与关键导入通过。完整依赖证据留本机，不将二进制或运行资料提交仓库。

[正式采用候选源](assets/adoption-sc01s-v0.2/README.md)固定SAP0.2.0、方法与当前合成输入／语义，复用已有去标识摘录。[五源清单](assets/adoption-sc01s-v0.2/sources.json)SHA `1ce91f34fbbea5527d0a4d92c694d767f379a62f78aaad0e553128eaf52463bf`；四份新JSON与已获准公开准备源字节相同，总五源35426 bytes。没有原企业附件、真实身份、旧Store／项目ID、金标准、模型或评分记录。本题条件只属于该SC-01S合成项目。

## 最终验证与交付

最终原`npm run check`退出0：1756项中1726通过、30项条件跳过、0失败；包括会话边界、类型检查与构建。Python适用回归80/80；7个官方Pi包来源回读通过。非作者Standards／Spec及最终测试／文档增量复核通过，新增必须修复项0。其发现的P2“启用已写入但回执未知后续办可能恢复已撤回来源”已由原作者补实际写入后故障反例，RED→GREEN修复并复核关闭。

完整检查此前一次因缺S4_RUN准备变量失败；再一次通过但7组资产检查条件跳过。最终只将该组夹具改为默认新OS临时子目录，保留全部断言，重跑完整检查取得上述结果；9项现已默认执行。646件最终源码／测试／资产身份与非作者回读一致，清单SHA `70abe35561a865ef8020d36c5d6886f8224d8568eb51a05edf114b3b95cba0b6`。30项跳过保留原可选环境／平台与工具条件，不记为通过。

旧固定代码在隔离合成根兼容读取新项目／M2／5条原生消息，原native字节保持；当前构建静态UI／API及3件资源回读通过，完整浏览器交互NOT_RUN。Git实际head CI和独立干净clone构建身份由本轮交付回执另核，不以本地通过冒充CI或正式采用。

目标现场在开工时仍为原`695b9f10…`／instance `5b77542c-582c-4f2a-a9e5-18756ceb82d5`。本轮只被动读取健康身份，不读正式业务Store或导出凭据。正式采用窗口将生成自己的项目／源Ref／图UUID；本轮隔离图身份仅作工程证明，不能作为正式绑定。
